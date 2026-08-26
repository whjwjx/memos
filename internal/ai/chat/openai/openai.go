// Package openai implements chat.Model against the OpenAI chat completions
// endpoint (and any compatible third-party endpoint such as OpenRouter,
// Groq, or a self-hosted vLLM / Ollama OpenAI-compatible server).
package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"

	openaisdk "github.com/openai/openai-go/v3"
	openaioption "github.com/openai/openai-go/v3/option"
	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/chat"
)

func truncateDebug(s string) string {
	if len(s) > 80 {
		return s[:80] + "..."
	}
	return s
}

const defaultEndpoint = "https://api.openai.com/v1"

// Model implements chat.Model for OpenAI-compatible chat endpoints.
type Model struct {
	client openaisdk.Client
}

// New constructs a Model from a provider config.
func New(cfg ai.ProviderConfig, options chat.Options) (*Model, error) {
	endpoint, err := normalizeEndpoint(cfg.Endpoint)
	if err != nil {
		return nil, err
	}
	if cfg.APIKey == "" {
		return nil, errors.New("OpenAI API key is required")
	}
	return &Model{
		client: openaisdk.NewClient(
			openaioption.WithAPIKey(cfg.APIKey),
			openaioption.WithBaseURL(endpoint),
			openaioption.WithHTTPClient(options.HTTPClient),
		),
	}, nil
}

// Generate sends the conversation to the chat completions endpoint.
func (m *Model) Generate(ctx context.Context, req chat.Request) (*chat.Response, error) {
	// DeepSeek/OpenAI reject a request where an assistant message carries
	// tool_calls but the following tool messages do not answer every call id
	// (or where an orphan tool message has no matching call). History rebuilt
	// from storage can become inconsistent across confirmation round-trips, so
	// we sanitize before sending: strip dangling tool_calls and drop orphan
	// tool messages. Well-formed histories pass through unchanged.
	messages := sanitizeToolMessages(req.Messages)
	if os.Getenv("MEMOS_DEBUG") == "ai" {
		for i, msg := range messages {
			ids := make([]string, 0, len(msg.ToolCalls))
			for _, tc := range msg.ToolCalls {
				ids = append(ids, tc.ID)
			}
			callIDs := strings.Join(ids, ",")
			fmt.Fprintf(os.Stderr, "[openai.debug] msg[%d] role=%q toolCallID=%q toolCalls=[%s] content=%q\n", i, msg.Role, msg.ToolCallID, callIDs, truncateDebug(msg.Content))
		}
	}
	if strings.TrimSpace(req.Model) == "" {
		return nil, errors.New("model is required")
	}
	if len(messages) == 0 && strings.TrimSpace(req.System) == "" {
		return nil, errors.New("at least one message or a system prompt is required")
	}

	params := openaisdk.ChatCompletionNewParams{
		Model: openaisdk.ChatModel(req.Model),
	}
	if req.System != "" {
		params.Messages = append(params.Messages, openaisdk.SystemMessage(req.System))
	}
	for _, msg := range messages {
		switch strings.ToLower(strings.TrimSpace(msg.Role)) {
		case chat.RoleAssistant:
			// An assistant message may carry tool calls that the model made in a
			// prior turn; forward them so the model sees its own pending calls.
			assistantMsg := openaisdk.AssistantMessage(msg.Content)
			if len(msg.ToolCalls) > 0 {
				withAssistantToolCalls(&assistantMsg, msg.ToolCalls)
			}
			params.Messages = append(params.Messages, assistantMsg)
		case chat.RoleSystem:
			params.Messages = append(params.Messages, openaisdk.SystemMessage(msg.Content))
		default:
			// A tool result message answers a prior tool call.
			if msg.Role == chat.RoleTool {
				params.Messages = append(params.Messages, openaisdk.ToolMessage(msg.Content, msg.ToolCallID))
				continue
			}
			params.Messages = append(params.Messages, openaisdk.UserMessage(msg.Content))
		}
	}
	if req.Temperature != nil {
		params.Temperature = openaisdk.Float(float64(*req.Temperature))
	}
	if req.MaxTokens > 0 {
		params.MaxCompletionTokens = openaisdk.Int(int64(req.MaxTokens))
	}
	if len(req.Tools) > 0 {
		params.Tools = make([]openaisdk.ChatCompletionToolUnionParam, 0, len(req.Tools))
		for _, tool := range req.Tools {
			params.Tools = append(params.Tools, openaisdk.ChatCompletionFunctionTool(openaisdk.FunctionDefinitionParam{
				Name:        tool.Name,
				Description: openaisdk.String(tool.Description),
				Parameters:  parseSchema(tool.ParametersJSON),
			}))
		}
		switch strings.ToLower(strings.TrimSpace(req.ToolChoice)) {
		case chat.ToolChoiceNone:
			// "none" as a plain string is accepted by both OpenAI and
			// OpenAI-compatible endpoints (e.g. DeepSeek) that reject the
			// object form {"type":"allowed_tools",...}.
			params.ToolChoice.OfAuto = openaisdk.String("none")
		case chat.ToolChoiceRequired:
			params.ToolChoice.OfAuto = openaisdk.String("required")
		case chat.ToolChoiceAuto:
			params.ToolChoice.OfAuto = openaisdk.String("auto")
		default:
			if req.ToolChoice != "" {
				// Force a specific function by name.
				params.ToolChoice = openaisdk.ToolChoiceOptionFunctionToolChoice(openaisdk.ChatCompletionNamedToolChoiceFunctionParam{
					Name: req.ToolChoice,
				})
			}
		}
	}

	resp, err := m.client.Chat.Completions.New(ctx, params)
	if err != nil {
		return nil, errors.Wrap(err, "failed to send OpenAI chat request")
	}
	if len(resp.Choices) == 0 {
		return nil, errors.New("OpenAI chat request returned no choices")
	}
	choice := resp.Choices[0]
	out := &chat.Response{
		Text:         strings.TrimSpace(choice.Message.Content),
		FinishReason: mapFinishReason(choice.FinishReason),
	}
	for _, tc := range choice.Message.ToolCalls {
		out.ToolCalls = append(out.ToolCalls, chat.ToolCall{
			ID:            tc.ID,
			Name:          tc.Function.Name,
			ArgumentsJSON: strings.TrimSpace(tc.Function.Arguments),
		})
	}
	return out, nil
}

// sanitizeToolMessages makes a message list safe for providers (OpenAI/DeepSeek)
// that require every assistant tool_calls entry to be immediately answered by a
// tool message carrying the matching tool_call_id. It is a defensive guard for
// histories reconstructed from storage, which can become inconsistent when a
// confirmation round-trip is interrupted. The rules:
//
//   - An assistant message whose tool_calls are not fully answered by the
//     consecutive tool messages that follow it has those tool_calls stripped
//     (its text is kept), so the provider does not see dangling calls.
//   - A tool message whose tool_call_id is not claimed by any assistant call in
//     the list is dropped as an orphan.
//
// Well-formed (complete) histories are returned unchanged.
func sanitizeToolMessages(messages []chat.Message) []chat.Message {
	// Pass 1: detect assistant turns with incomplete tool-call answers and strip
	// their tool_calls in place.
	stripped := make([]chat.Message, len(messages))
	copy(stripped, messages)
	for i, m := range stripped {
		if m.Role != chat.RoleAssistant || len(m.ToolCalls) == 0 {
			continue
		}
		need := make(map[string]bool, len(m.ToolCalls))
		for _, tc := range m.ToolCalls {
			need[tc.ID] = true
		}
		got := make(map[string]bool)
		for j := i + 1; j < len(stripped) && stripped[j].Role == chat.RoleTool; j++ {
			if stripped[j].ToolCallID != "" {
				got[stripped[j].ToolCallID] = true
			}
		}
		complete := true
		for id := range need {
			if !got[id] {
				complete = false
				break
			}
		}
		if !complete {
			stripped[i].ToolCalls = nil
		}
	}

	// Pass 2: collect every tool_call id that is still claimed by an assistant
	// turn, then drop orphan tool messages.
	claimed := make(map[string]bool)
	for _, m := range stripped {
		if m.Role == chat.RoleAssistant {
			for _, tc := range m.ToolCalls {
				claimed[tc.ID] = true
			}
		}
	}
	out := make([]chat.Message, 0, len(stripped))
	for _, m := range stripped {
		if m.Role == chat.RoleTool && (m.ToolCallID == "" || !claimed[m.ToolCallID]) {
			continue
		}
		out = append(out, m)
	}
	return out
}

// withAssistantToolCalls attaches previously-requested tool calls to an
// assistant message so the model can see its own pending invocations. It
// mutates the union's embedded assistant message in place.
func withAssistantToolCalls(msg *openaisdk.ChatCompletionMessageParamUnion, calls []chat.ToolCall) {
	if msg == nil || msg.OfAssistant == nil {
		return
	}
	toolCalls := make([]openaisdk.ChatCompletionMessageToolCallUnionParam, 0, len(calls))
	for _, c := range calls {
		toolCalls = append(toolCalls, openaisdk.ChatCompletionMessageToolCallUnionParam{
			OfFunction: &openaisdk.ChatCompletionMessageFunctionToolCallParam{
				ID: c.ID,
				Function: openaisdk.ChatCompletionMessageFunctionToolCallFunctionParam{
					Name:      c.Name,
					Arguments: c.ArgumentsJSON,
				},
			},
		})
	}
	msg.OfAssistant.ToolCalls = toolCalls
}

// parseSchema converts a JSON Schema string into the map form expected by the
// OpenAI SDK. A blank or invalid schema yields an empty object schema.
func parseSchema(raw string) openaisdk.FunctionParameters {
	if strings.TrimSpace(raw) == "" {
		return openaisdk.FunctionParameters{}
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		return openaisdk.FunctionParameters{}
	}
	return openaisdk.FunctionParameters(m)
}

func mapFinishReason(reason string) chat.FinishReason {
	switch reason {
	case "stop":
		return chat.FinishStop
	case "length":
		return chat.FinishLength
	case "content_filter":
		return chat.FinishSafety
	default:
		return chat.FinishOther
	}
}

func normalizeEndpoint(endpoint string) (string, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = defaultEndpoint
	}
	if _, err := url.ParseRequestURI(endpoint); err != nil {
		return "", errors.Wrap(err, "invalid OpenAI endpoint")
	}
	return strings.TrimRight(endpoint, "/"), nil
}
