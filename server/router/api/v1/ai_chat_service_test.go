package v1

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/internal/ai/tools"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/test"
)

func newTestAIChatService(t *testing.T) (*APIV1Service, *store.User, context.Context) {
	ctx := context.Background()
	s := &APIV1Service{
		Store: test.NewTestingStore(ctx, t),
	}
	user, err := s.Store.CreateUser(ctx, &store.User{
		Username:     "chat-user",
		Role:         store.RoleUser,
		PasswordHash: "hash",
	})
	require.NoError(t, err)
	require.NotZero(t, user.ID, "created user should have an ID")
	authedCtx := auth.SetUserInContext(ctx, user, "")
	return s, user, authedCtx
}

func TestAIChatRequiresAuth(t *testing.T) {
	s, _, _ := newTestAIChatService(t)
	defer s.Store.Close()
	_, err := s.CreateConversation(context.Background(), &connect.Request[v1pb.CreateConversationRequest]{Msg: &v1pb.CreateConversationRequest{}})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.Unauthenticated, st.Code())
}

func TestAIChatConversationCRUD(t *testing.T) {
	s, _, ctx := newTestAIChatService(t)
	defer s.Store.Close()

	// Create.
	created, err := s.CreateConversation(ctx, &connect.Request[v1pb.CreateConversationRequest]{
		Msg: &v1pb.CreateConversationRequest{Title: "my chat"},
	})
	require.NoError(t, err)
	require.NotEmpty(t, created.Msg.Id)
	require.Equal(t, "my chat", created.Msg.Title)

	// List.
	list, err := s.ListConversations(ctx, &connect.Request[v1pb.ListConversationsRequest]{Msg: &v1pb.ListConversationsRequest{}})
	require.NoError(t, err)
	require.Len(t, list.Msg.Conversations, 1)

	// Get.
	got, err := s.GetConversation(ctx, &connect.Request[v1pb.GetConversationRequest]{
		Msg: &v1pb.GetConversationRequest{Id: created.Msg.Id},
	})
	require.NoError(t, err)
	require.Equal(t, created.Msg.Id, got.Msg.Conversation.Id)

	_, err = s.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{
			ChatAgents: []*storepb.ChatAgentConfig{
				{Id: "research", Name: "Research", Enabled: true},
			},
		}},
	})
	require.NoError(t, err)
	updated, err := s.UpdateConversation(ctx, &connect.Request[v1pb.UpdateConversationRequest]{
		Msg: &v1pb.UpdateConversationRequest{
			Conversation: &v1pb.Conversation{Id: created.Msg.Id, AgentId: "research"},
			UpdateMask:   &fieldmaskpb.FieldMask{Paths: []string{"agent_id"}},
		},
	})
	require.NoError(t, err)
	require.Equal(t, "research", updated.Msg.AgentId)

	// Delete.
	_, err = s.DeleteConversation(ctx, &connect.Request[v1pb.DeleteConversationRequest]{
		Msg: &v1pb.DeleteConversationRequest{Id: created.Msg.Id},
	})
	require.NoError(t, err)

	list, err = s.ListConversations(ctx, &connect.Request[v1pb.ListConversationsRequest]{Msg: &v1pb.ListConversationsRequest{}})
	require.NoError(t, err)
	require.Empty(t, list.Msg.Conversations)
}

func TestAIChatCreateConversationRejectsInvalidAgent(t *testing.T) {
	s, _, ctx := newTestAIChatService(t)
	defer s.Store.Close()

	_, err := s.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{
			ChatAgents: []*storepb.ChatAgentConfig{
				{Id: "disabled", Name: "Disabled", Enabled: false},
			},
		}},
	})
	require.NoError(t, err)

	_, err = s.CreateConversation(ctx, &connect.Request[v1pb.CreateConversationRequest]{
		Msg: &v1pb.CreateConversationRequest{AgentId: "missing"},
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.FailedPrecondition, st.Code())

	_, err = s.CreateConversation(ctx, &connect.Request[v1pb.CreateConversationRequest]{
		Msg: &v1pb.CreateConversationRequest{AgentId: "disabled"},
	})
	require.Error(t, err)
	st, ok = status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.FailedPrecondition, st.Code())
}

func TestPrepareAIChatTurnRejectsInvalidLLMWithoutPersisting(t *testing.T) {
	s, user, ctx := newTestAIChatService(t)
	defer s.Store.Close()

	_, err := s.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{
			ChatAgents: []*storepb.ChatAgentConfig{
				{Id: "default", Name: "Default", Enabled: true},
			},
		}},
	})
	require.NoError(t, err)
	conv, err := s.Store.CreateConversation(ctx, &store.CreateConversation{
		UID:    "llm-validation",
		UserID: user.ID,
	})
	require.NoError(t, err)

	_, err = s.prepareAIChatTurn(ctx, &v1pb.SendMessageRequest{
		ConversationId: conv.UID,
		Content:        "hello",
		LlmId:          "missing",
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.FailedPrecondition, st.Code())

	got, err := s.Store.GetConversation(ctx, &store.FindConversation{ID: &conv.ID})
	require.NoError(t, err)
	require.Empty(t, got.LLMID)

	messages, err := s.Store.ListConversationMessages(ctx, &store.FindConversationMessage{ConversationID: &conv.ID})
	require.NoError(t, err)
	require.Empty(t, messages)
}

func TestAIChatGetMissingReturnsNotFound(t *testing.T) {
	s, _, ctx := newTestAIChatService(t)
	defer s.Store.Close()
	_, err := s.GetConversation(ctx, &connect.Request[v1pb.GetConversationRequest]{Msg: &v1pb.GetConversationRequest{Id: "does-not-exist"}})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.NotFound, st.Code())
}

func TestHasToolDecisions(t *testing.T) {
	require.False(t, hasToolDecisions(&v1pb.SendMessageRequest{Content: "hello"}))
	require.True(t, hasToolDecisions(&v1pb.SendMessageRequest{ApprovedToolCallIds: []string{"call-1"}}))
	require.True(t, hasToolDecisions(&v1pb.SendMessageRequest{RejectedToolCallIds: []string{"call-1"}}))
	require.True(t, hasToolDecisions(&v1pb.SendMessageRequest{
		ToolApprovals: []*v1pb.ToolApproval{{ToolCallId: "call-1", ConfirmKeyword: "yes"}},
	}))
}

func TestLoadChatHistorySkipsLegacyToolApprovalMessage(t *testing.T) {
	s, user, ctx := newTestAIChatService(t)
	defer s.Store.Close()

	conv, err := s.Store.CreateConversation(ctx, &store.CreateConversation{
		UID:    "history-filter",
		UserID: user.ID,
	})
	require.NoError(t, err)
	_, err = s.Store.CreateConversationMessage(ctx, &store.CreateConversationMessage{
		ConversationID: conv.ID,
		Role:           chat.RoleUser,
		Content:        "delete memo abc",
	})
	require.NoError(t, err)
	_, err = s.Store.CreateConversationMessage(ctx, &store.CreateConversationMessage{
		ConversationID: conv.ID,
		Role:           chat.RoleUser,
		Content:        legacyToolApprovalUserMessage,
	})
	require.NoError(t, err)
	_, err = s.Store.CreateConversationMessage(ctx, &store.CreateConversationMessage{
		ConversationID: conv.ID,
		Role:           chat.RoleAssistant,
		Content:        "done",
	})
	require.NoError(t, err)

	history, err := s.loadChatHistory(ctx, conv.ID, 0)
	require.NoError(t, err)
	require.Len(t, history, 2)
	require.Equal(t, "delete memo abc", history[0].Content)
	require.Equal(t, "done", history[1].Content)
}

func TestApplyToolConfigScopeIsolation(t *testing.T) {
	s, user, ctx := newTestAIChatService(t)
	defer s.Store.Close()
	require.Equal(t, store.RoleUser, user.Role)

	admin, err := s.Store.CreateUser(ctx, &store.User{
		Username:     "chat-admin",
		Role:         store.RoleAdmin,
		PasswordHash: "hash",
	})
	require.NoError(t, err)

	// Save per-tool config: search_memos disabled, delete_memo explicitly set to
	// no confirmation (differs from its built-in default).
	_, err = s.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{
			Tools: map[string]*storepb.ToolConfig{
				"search_memos": {Enabled: false},
				"delete_memo":  {Enabled: true, RequiresConfirmation: false},
			},
		}},
	})
	require.NoError(t, err)

	t.Run("non-admin cannot see admin-only tools", func(t *testing.T) {
		registry := tools.NewRegistry()
		s.applyToolConfig(ctx, registry, user.ID)

		// Admin-only tools are removed entirely for non-admin users.
		require.Nil(t, registry.Get("get_logs"))
		require.Nil(t, registry.Get("query_db"))
		require.Nil(t, registry.Get("query_queue"))
		require.Nil(t, registry.Get("project_status"))
		// Disabled tools are removed entirely too.
		require.Nil(t, registry.Get("search_memos"))
		// Explicitly configured confirmation is honored.
		require.False(t, registry.Get("delete_memo").RequiresConfirmation(""))
		// Unconfigured tools keep their built-in behavior: mutating tools
		// require confirmation, read-only ones don't.
		require.True(t, registry.Get("create_memo").RequiresConfirmation(""))
		require.False(t, registry.Get("get_comments").RequiresConfirmation(""))
	})

	t.Run("admin keeps admin-only tools", func(t *testing.T) {
		registry := tools.NewRegistry()
		s.applyToolConfig(ctx, registry, admin.ID)

		require.NotNil(t, registry.Get("get_logs"))
		require.NotNil(t, registry.Get("query_db"))
		require.NotNil(t, registry.Get("query_queue"))
		require.NotNil(t, registry.Get("project_status"))
		require.Nil(t, registry.Get("search_memos"))
		require.False(t, registry.Get("delete_memo").RequiresConfirmation(""))
	})

	t.Run("no saved config keeps full default registry", func(t *testing.T) {
		ctx2 := context.Background()
		s2, user2, _ := newTestAIChatService(t)
		defer s2.Store.Close()

		registry := tools.NewRegistry()
		s2.applyToolConfig(ctx2, registry, user2.ID)

		// Non-admin still loses admin-only tools...
		require.Nil(t, registry.Get("get_logs"))
		require.Nil(t, registry.Get("query_db"))
		require.Nil(t, registry.Get("query_queue"))
		require.Nil(t, registry.Get("project_status"))
		// ...but all non-admin tools are enabled with built-in confirmation.
		require.NotNil(t, registry.Get("search_memos"))
		require.NotNil(t, registry.Get("create_memo"))
	})
}

func TestResolveChatRuntimeProfile(t *testing.T) {
	t.Run("uses defaults and auto detects deepseek compatible providers", func(t *testing.T) {
		profile := resolveChatRuntimeProfile(ai.ProviderConfig{
			Type:     ai.ProviderOpenAI,
			Title:    "DeepSeek",
			Endpoint: "https://api.deepseek.com",
		}, "deepseek-chat", nil)

		require.NotNil(t, profile.temperature)
		require.InDelta(t, defaultChatTemperature, *profile.temperature, 0.001)
		require.Equal(t, defaultChatMaxOutputTokens, profile.maxTokens)
		require.Equal(t, compatibilityPresetDeepSeekCompatible, profile.compatibilityPreset)
		require.NotEmpty(t, buildCompatibilityGuidance(profile.compatibilityPreset))
	})

	t.Run("uses configured overrides", func(t *testing.T) {
		temperature := float32(0)
		profile := resolveChatRuntimeProfile(ai.ProviderConfig{Type: ai.ProviderOpenAI}, "gpt-4o-mini", &storepb.LLMConfig{
			Temperature:         &temperature,
			MaxOutputTokens:     4096,
			CompatibilityPreset: compatibilityPresetStrictTools,
		})

		require.NotNil(t, profile.temperature)
		require.Equal(t, float32(0), *profile.temperature)
		require.Equal(t, 4096, profile.maxTokens)
		require.Equal(t, compatibilityPresetStrictTools, profile.compatibilityPreset)
	})
}

func TestSanitizeAssistantContentStripsPseudoToolBlocks(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{
			name: "localized pseudo tool block",
			content: `Deleted memo abc.
<工具调用>
{"name":"search_memos","arguments":{"query":"张雪峰"}}
\</工具调用>`,
			want: "Deleted memo abc.",
		},
		{
			name: "english pseudo tool block only",
			content: `<tool_calls>
<invoke name="search_memos"></invoke>
</tool_calls>`,
			want: "已完成相关操作。",
		},
		{
			name:    "empty code block only",
			content: "```text\n\n```",
			want:    "已完成相关操作。",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sanitizeAssistantContent(tt.content)
			require.Equal(t, tt.want, got)
			require.NotContains(t, got, "<工具调用>")
			require.NotContains(t, got, "search_memos")
			require.NotContains(t, got, "<tool_calls>")
			require.NotContains(t, got, "```")
		})
	}
}
