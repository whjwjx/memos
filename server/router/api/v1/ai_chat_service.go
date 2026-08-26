package v1

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	shortuuid "github.com/lithammer/shortuuid/v4"
	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/ai"
	agentpkg "github.com/usememos/memos/internal/ai/agent"
	"github.com/usememos/memos/internal/ai/assistant"
	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/internal/ai/tools"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// chatOperationalGuidance is appended to every chat agent's system prompt so the
// model cooperates with the client-side confirmation flow. It must not ask the
// user to verbally confirm sensitive actions — the client already gates those
// behind an explicit approval card.
const chatOperationalGuidance = `Operational guidance:
- When the user requests a sensitive action such as deleting a memo, call the corresponding tool directly. Do NOT first ask the user to verbally confirm or reply "yes" — the client will present a confirmation card and only run the tool after the user approves there.
- After a tool executes, briefly report the outcome in natural language. Do not repeat the raw tool result verbatim.
- If you are unsure which memo the user means, use search_memos (with an empty query to list recent memos) to find it before acting.`

// AIChatService implements the conversational AI assistant with tool calling.
// Its methods are defined on *APIV1Service so the shared Connect handler can
// register them without an extra embedding layer.

func (s *APIV1Service) CreateConversation(ctx context.Context, request *connect.Request[v1pb.CreateConversationRequest]) (*connect.Response[v1pb.Conversation], error) {
	req := request.Msg
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Unauthenticated, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	uid := newResourceUID()
	conv, err := s.Store.CreateConversation(ctx, &store.CreateConversation{
		UID:     uid,
		UserID:  user.ID,
		Title:   req.Title,
		AgentID: req.AgentId,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to create conversation: %v", err)
	}
	return connect.NewResponse(convertConversationFromStore(conv)), nil
}

func (s *APIV1Service) ListConversations(ctx context.Context, request *connect.Request[v1pb.ListConversationsRequest]) (*connect.Response[v1pb.ListConversationsResponse], error) {
	req := request.Msg
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Unauthenticated, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	limit := int(req.PageSize)
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	convs, err := s.Store.ListConversations(ctx, &store.FindConversation{
		UserID: &user.ID,
		Limit:  &limit,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list conversations: %v", err)
	}
	response := &v1pb.ListConversationsResponse{}
	for _, conv := range convs {
		response.Conversations = append(response.Conversations, convertConversationFromStore(conv))
	}
	return connect.NewResponse(response), nil
}

func (s *APIV1Service) GetConversation(ctx context.Context, request *connect.Request[v1pb.GetConversationRequest]) (*connect.Response[v1pb.GetConversationResponse], error) {
	req := request.Msg
	conv, err := s.findOwnedConversation(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	messages, err := s.Store.ListConversationMessages(ctx, &store.FindConversationMessage{
		ConversationID: &conv.ID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list messages: %v", err)
	}
	response := &v1pb.GetConversationResponse{
		Conversation: convertConversationFromStore(conv),
	}
	for _, msg := range messages {
		response.Messages = append(response.Messages, convertMessageFromStore(msg))
	}
	return connect.NewResponse(response), nil
}

func (s *APIV1Service) DeleteConversation(ctx context.Context, request *connect.Request[v1pb.DeleteConversationRequest]) (*connect.Response[v1pb.DeleteConversationResponse], error) {
	req := request.Msg
	conv, err := s.findOwnedConversation(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	if err := s.Store.DeleteConversation(ctx, conv.ID); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete conversation: %v", err)
	}
	return connect.NewResponse(&v1pb.DeleteConversationResponse{}), nil
}

func (s *APIV1Service) UpdateConversation(ctx context.Context, request *connect.Request[v1pb.UpdateConversationRequest]) (*connect.Response[v1pb.Conversation], error) {
	req := request.Msg
	if req.Conversation == nil || req.Conversation.Id == "" {
		return nil, status.Errorf(codes.InvalidArgument, "conversation id is required")
	}
	conv, err := s.findOwnedConversation(ctx, req.Conversation.Id)
	if err != nil {
		return nil, err
	}
	update := &store.UpdateConversation{
		ID: conv.ID,
	}
	if req.UpdateMask == nil || containsPath(req.UpdateMask.Paths, "title") {
		title := req.Conversation.Title
		update.Title = &title
	}
	updated, err := s.Store.UpdateConversation(ctx, update)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to update conversation: %v", err)
	}
	return connect.NewResponse(convertConversationFromStore(updated)), nil
}

func containsPath(paths []string, target string) bool {
	if len(paths) == 0 {
		return true
	}
	for _, p := range paths {
		if p == target {
			return true
		}
	}
	return false
}

func (s *APIV1Service) SendMessage(ctx context.Context, request *connect.Request[v1pb.SendMessageRequest]) (*connect.Response[v1pb.SendMessageResponse], error) {
	req := request.Msg
	conv, err := s.findOwnedConversation(ctx, req.ConversationId)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Content) == "" {
		return nil, status.Errorf(codes.InvalidArgument, "content is required")
	}

	// Persist the incoming user message.
	userMsg, err := s.Store.CreateConversationMessage(ctx, &store.CreateConversationMessage{
		ConversationID: conv.ID,
		Role:           "user",
		Content:        req.Content,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to store user message: %v", err)
	}

	// Load the prior history (everything before this turn).
	history, err := s.loadChatHistory(ctx, conv.ID, userMsg.ID)
	if err != nil {
		return nil, err
	}

	// Build the provider config from the instance AI setting's enabled agent.
	providerCfg, systemPrompt, err := s.resolveChatProvider(ctx, conv.AgentID)
	if err != nil {
		return nil, err
	}

	// Append operational guidance so the model behaves predictably with the
	// client-side confirmation flow: when the user asks for a sensitive action
	// (e.g. delete a memo), call the tool directly instead of first asking the
	// user to verbally confirm — the client will surface a confirmation card and
	// only execute after the user approves there.
	systemPrompt = strings.TrimSpace(systemPrompt + "\n\n" + chatOperationalGuidance)

	registry := tools.NewRegistry()
	// Honor the per-tool enable toggles from instance config.
	s.applyToolConfig(ctx, registry)

	resp, err := assistant.ToolLoop(ctx, providerCfg.model, &assistant.AssistantRequest{
		System:              systemPrompt,
		History:             history,
		UserContent:         req.Content,
		Model:               providerCfg.modelName,
		ChatOptions:         chat.ApplyOptions(nil),
		Registry:            registry,
		ToolContext:         tools.ToolContext{UserID: conv.UserID, Store: s.Store},
		ApprovedToolCallIDs: req.ApprovedToolCallIds,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "chat loop failed: %v", err)
	}

	// Persist the assistant turn(s).
	assistantMsg, err := s.Store.CreateConversationMessage(ctx, &store.CreateConversationMessage{
		ConversationID: conv.ID,
		Role:           "assistant",
		Content:        resp.Content,
		ToolCalls:      marshalToolCalls(resp.ToolCalls),
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to store assistant message: %v", err)
	}

	response := &v1pb.SendMessageResponse{
		Content:              resp.Content,
		RequiresConfirmation: resp.RequiresConfirmation,
	}
	response.Messages = append(response.Messages, convertMessageFromStore(assistantMsg))
	for _, tc := range resp.ToolCalls {
		requiresConfirmation := true
		if tool := registry.Get(tc.Name); tool != nil {
			requiresConfirmation = tool.RequiresConfirmation(tc.ArgumentsJSON)
		}
		response.ToolCalls = append(response.ToolCalls, &v1pb.ToolCall{
			Id:                   tc.ID,
			Name:                 tc.Name,
			Arguments:            tc.ArgumentsJSON,
			RequiresConfirmation: requiresConfirmation,
		})
	}

	// Persist the tool-result turns produced this round (including the real
	// results of approved calls, which replace the pending "awaiting confirmation"
	// placeholders). A pending tool message already stored from a prior turn is
	// updated in place (matched by tool_call_id) so the history stays valid and
	// no duplicate rows accumulate.
	existingByToolCallID := make(map[string]int32)
	existing, err := s.Store.ListConversationMessages(ctx, &store.FindConversationMessage{
		ConversationID: &conv.ID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load existing messages: %v", err)
	}
	for _, m := range existing {
		if m.Role == "tool" && m.ToolCallID != "" {
			existingByToolCallID[m.ToolCallID] = m.ID
		}
	}
	for _, tm := range resp.ToolMessages {
		if existingID, ok := existingByToolCallID[tm.ToolCallID]; ok {
			content := tm.Content
			name := tm.Name
			if err := s.Store.UpdateConversationMessage(ctx, &store.UpdateConversationMessage{
				ID:      existingID,
				Content: &content,
				Name:    &name,
			}); err != nil {
				return nil, status.Errorf(codes.Internal, "failed to update tool message: %v", err)
			}
			response.Messages = append(response.Messages, &v1pb.ConversationMessage{
				Id:         itoa(existingID),
				Role:       tm.Role,
				Content:    tm.Content,
				ToolCallId: tm.ToolCallID,
				Name:       tm.Name,
			})
			continue
		}
		toolMsg, err := s.Store.CreateConversationMessage(ctx, &store.CreateConversationMessage{
			ConversationID: conv.ID,
			Role:           tm.Role,
			Content:        tm.Content,
			ToolCallID:     tm.ToolCallID,
			Name:           tm.Name,
		})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to store tool message: %v", err)
		}
		response.Messages = append(response.Messages, convertMessageFromStore(toolMsg))
	}

	return connect.NewResponse(response), nil
}

// findOwnedConversation resolves a conversation by uid and verifies ownership.
func (s *APIV1Service) findOwnedConversation(ctx context.Context, uid string) (*store.Conversation, error) {
	if strings.TrimSpace(uid) == "" {
		return nil, status.Errorf(codes.InvalidArgument, "conversation id is required")
	}
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Unauthenticated, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	conv, err := s.Store.GetConversation(ctx, &store.FindConversation{
		UID:    &uid,
		UserID: &user.ID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get conversation: %v", err)
	}
	if conv == nil {
		return nil, status.Errorf(codes.NotFound, "conversation %q not found", uid)
	}
	return conv, nil
}

// loadChatHistory returns the prior messages as chat.Message, excluding the
// message with excludeID (the just-created user turn is passed separately).
func (s *APIV1Service) loadChatHistory(ctx context.Context, conversationID int32, excludeID int32) ([]chat.Message, error) {
	messages, err := s.Store.ListConversationMessages(ctx, &store.FindConversationMessage{
		ConversationID: &conversationID,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load history: %v", err)
	}
	out := make([]chat.Message, 0, len(messages))
	for _, m := range messages {
		if m.ID == excludeID {
			continue
		}
		out = append(out, chat.Message{
			Role:       m.Role,
			Content:    m.Content,
			ToolCalls:  parseToolCalls(m.ToolCalls),
			ToolCallID: m.ToolCallID,
			Name:       m.Name,
		})
	}
	return out, nil
}

// resolveChatProvider picks the provider bound to the conversation's agent (or the
// first enabled chat agent) and returns a ready chat model plus its system prompt.
func (s *APIV1Service) resolveChatProvider(ctx context.Context, agentID string) (providerBundle, string, error) {
	setting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return providerBundle{}, "", status.Errorf(codes.Internal, "failed to load AI setting: %v", err)
	}
	if setting == nil {
		return providerBundle{}, "", status.Errorf(codes.FailedPrecondition, "AI is not configured")
	}

	var agent *storepb.ChatAgentConfig
	for _, a := range setting.GetChatAgents() {
		if !a.GetEnabled() {
			continue
		}
		if agentID != "" && a.GetId() != agentID {
			continue
		}
		agent = a
		break
	}
	if agent == nil {
		return providerBundle{}, "", status.Errorf(codes.FailedPrecondition, "no enabled chat agent configured")
	}
	provider := findProviderByID(setting.GetProviders(), agent.GetProviderId())
	if provider == nil || provider.GetApiKey() == "" {
		return providerBundle{}, "", status.Errorf(codes.FailedPrecondition, "chat agent provider %q is not configured", agent.GetProviderId())
	}

	model, err := agentpkg.NewChatModel(ai.ProviderConfig{
		ID:       provider.GetId(),
		Type:     convertAIProviderTypeFromStore(provider.GetType()),
		Endpoint: provider.GetEndpoint(),
		APIKey:   provider.GetApiKey(),
	}, chat.ApplyOptions(nil))
	if err != nil {
		return providerBundle{}, "", status.Errorf(codes.Internal, "failed to build chat model: %v", err)
	}
	return providerBundle{model: model, modelName: agent.GetModel()}, agent.GetSystemPrompt(), nil
}

// readOnlyTools are pure-query tools that have no side effects, so they never
// require confirmation and are exempt from the admin's confirmation toggle.
// Keep in sync with the confirmEditable=false entries in the settings UI.
var readOnlyTools = map[string]bool{
	"search_memos": true,
	"get_comments": true,
}

// applyToolConfig applies the admin's per-tool toggles from instance settings
// onto the registry: it disables tools toggled off, and honors the confirmation
// flag for tools the admin explicitly configured. Tools not present in the
// settings keep their built-in behavior.
func (s *APIV1Service) applyToolConfig(ctx context.Context, registry *tools.Registry) {
	setting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil || setting == nil {
		return
	}
	for name, cfg := range setting.GetTools() {
		tool := registry.Get(name)
		if tool == nil {
			continue
		}
		if !cfg.GetEnabled() {
			registry.Register(disabledTool{name: name})
			continue
		}
		// Read-only tools are never confirmed; ignore any admin flag for them.
		if readOnlyTools[name] {
			continue
		}
		// Only wrap when the admin's confirmation flag differs from the tool's
		// built-in default, so un-configured fields don't silently override it.
		if cfg.GetRequiresConfirmation() != tool.RequiresConfirmation("") {
			registry.Register(configuredTool{Tool: tool, requiresConfirmation: cfg.GetRequiresConfirmation()})
		}
	}
}

type providerBundle struct {
	model     chat.Model
	modelName string
}

func convertConversationFromStore(conv *store.Conversation) *v1pb.Conversation {
	return &v1pb.Conversation{
		Id:         conv.UID,
		Name:       "conversations/" + conv.UID,
		Title:      conv.Title,
		AgentId:    conv.AgentID,
		CreateTime: conv.CreatedTs,
		UpdateTime: conv.UpdatedTs,
	}
}

func convertMessageFromStore(msg *store.ConversationMessage) *v1pb.ConversationMessage {
	out := &v1pb.ConversationMessage{
		Id:      itoa(msg.ID),
		Role:    msg.Role,
		Content: msg.Content,
	}
	for _, tc := range parseToolCalls(msg.ToolCalls) {
		out.ToolCalls = append(out.ToolCalls, &v1pb.ToolCall{
			Id:        tc.ID,
			Name:      tc.Name,
			Arguments: tc.ArgumentsJSON,
		})
	}
	if msg.Role == "tool" {
		out.ToolCallId = msg.ToolCallID
		out.Name = msg.Name
	}
	return out
}

func itoa(v int32) string {
	return strconv.Itoa(int(v))
}

func parseToolCalls(raw string) []chat.ToolCall {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var calls []chat.ToolCall
	if err := json.Unmarshal([]byte(raw), &calls); err != nil {
		return nil
	}
	return calls
}

func marshalToolCalls(calls []chat.ToolCall) string {
	if len(calls) == 0 {
		return ""
	}
	raw, err := json.Marshal(calls)
	if err != nil {
		return ""
	}
	return string(raw)
}

func findProviderByID(providers []*storepb.AIProviderConfig, id string) *storepb.AIProviderConfig {
	for _, p := range providers {
		if p.GetId() == id {
			return p
		}
	}
	return nil
}

// disabledTool is a placeholder that reports itself unavailable so disabled tools
// are never offered to the model.
type disabledTool struct {
	name string
}

func (t disabledTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{Name: t.name, Description: "disabled", ParametersJSON: `{"type":"object","properties":{}}`}
}

func (disabledTool) RequiresConfirmation(_ string) bool {
	return false
}

func (t disabledTool) Run(_ context.Context, _ tools.ToolContext, _ string) (string, error) {
	return "", errors.Errorf("tool %q is disabled", t.name)
}

// configuredTool wraps a tool with the admin's per-tool confirmation flag so the
// instance-level toggle is honored at runtime. Run and Spec delegate to the
// wrapped tool unchanged.
type configuredTool struct {
	tools.Tool
	requiresConfirmation bool
}

func (t configuredTool) RequiresConfirmation(_ string) bool {
	return t.requiresConfirmation
}

func newResourceUID() string {
	return shortuuid.New()
}
