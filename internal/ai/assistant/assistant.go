// Package assistant drives the conversational AI loop: it feeds the model a
// tool-exposing request, executes the tools the model asks for, and feeds the
// results back until the model produces a final answer. Sensitive tools can be
// gated behind an explicit confirmation step (see ToolLoop.Run).
package assistant

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai"
	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/internal/ai/tools"
)

const (
	// maxToolRounds caps how many tool-call iterations a single turn may run
	// before we stop and return whatever the model produced.
	maxToolRounds = 8
	// awaitingConfirmationPlaceholder marks a sensitive tool call that has not
	// been decided by the user yet. It is persisted in the history and replaced
	// by the real result (or a skipped note) once the user decides.
	awaitingConfirmationPlaceholder = "awaiting user confirmation"
)

// AssistantRequest carries everything ToolLoop needs for one user turn.
type AssistantRequest struct {
	// System is the assistant system prompt.
	System string
	// History is the conversation so far (excluding the new user turn).
	History []chat.Message
	// UserContent is the latest user message.
	UserContent string
	// Model is the provider-specific model identifier passed to chat.Generate.
	Model string
	// Provider builds the chat model used for generation.
	Provider ai.ProviderConfig
	// ChatOptions are passed through to the chat model constructor.
	ChatOptions chat.Options
	// Registry holds the available tools.
	Registry *tools.Registry
	// ToolContext is passed to every tool execution.
	ToolContext tools.ToolContext
	// ApprovedToolCallIDs are the tool call ids the user confirmed in a prior
	// turn. Tool calls requiring confirmation are only executed when their id
	// is present here.
	ApprovedToolCallIDs []string
	// RejectedToolCallIDs are the tool call ids the user explicitly rejected in
	// a prior turn. Their pending placeholders are recorded as skipped and the
	// loop continues without executing them.
	RejectedToolCallIDs []string
	// Approvals maps approved tool call ids to the keyword the user typed to
	// confirm a sensitive write (e.g. "yes"). The keyword is injected into the
	// tool arguments before execution so second-factor-gated tools can verify
	// it; the model never sets it by itself.
	Approvals map[string]string
}

// AssistantResponse is what a single turn yields.
type AssistantResponse struct {
	// Content is the assistant's final reply text (empty if still pending tools).
	Content string
	// ToolCalls are the tool invocations requested this turn. When
	// RequiresConfirmation is true, the caller must confirm the sensitive ones
	// (RequiresConfirmation=true) and re-run with ApprovedToolCallIDs set.
	ToolCalls []chat.ToolCall
	// ToolMessages are the tool-result messages produced this turn (one per
	// tool call, including the "awaiting confirmation" placeholders for pending
	// calls). The caller must persist these so that subsequent turns can rebuild
	// a complete message history for the model.
	ToolMessages []chat.Message
	// RequiresConfirmation is true when the assistant requested a sensitive tool
	// the user has not yet approved.
	RequiresConfirmation bool
}

// ToolLoop runs the generate → execute → feed-back loop for one user turn. The
// caller is responsible for building the chat.Model (so tests can inject a fake)
// and passes it in.
func ToolLoop(ctx context.Context, model chat.Model, req *AssistantRequest) (*AssistantResponse, error) {
	return runLoop(ctx, model, req)
}

func runLoop(ctx context.Context, model chat.Model, req *AssistantRequest) (*AssistantResponse, error) {
	approved := toSet(req.ApprovedToolCallIDs)
	rejected := toSet(req.RejectedToolCallIDs)

	// Build the working message list: history + new user turn.
	messages := make([]chat.Message, 0, len(req.History)+2)
	messages = append(messages, req.History...)
	messages = append(messages, chat.Message{Role: chat.RoleUser, Content: req.UserContent})

	registry := req.Registry
	if registry == nil {
		registry = tools.NewRegistry()
	}

	// When the user decided pending tool calls from a prior turn (approved or
	// rejected), the orchestrator applies those decisions directly — we never
	// rely on the model re-issuing the call with a matching id. Approved calls
	// are executed and their real results overwrite the placeholder tool
	// messages in place (preserving a valid message order); rejected calls get
	// a skipped note. Afterwards we force ToolChoiceNone (with no tool
	// definitions and a flattened history) so the model only produces a final
	// answer summarizing every decision.
	if len(approved) > 0 || len(rejected) > 0 {
		updated := applyApprovedResults(ctx, req, registry, approved, req.Approvals, messages)
		updated = append(updated, applyRejectedResults(messages, rejected)...)
		if len(updated) > 0 {
			// Give the model no function-calling material to mimic: flatten the
			// history so earlier assistant tool_calls and their tool results
			// become plain text, and omit the tool definitions entirely. With no
			// Tools list (and thus no tool_choice at all), the model cannot
			// "demonstrate" another call — it can only produce a natural-language
			// summary. This is far more robust than relying on tool_choice:"none",
			// which some models (e.g. DeepSeek) ignore by echoing pseudo-XML.
			flattened := flattenHistory(messages)
			resp, err := model.Generate(ctx, chat.Request{
				Model:      req.Model,
				System:     req.System,
				Messages:   flattened,
				ToolChoice: chat.ToolChoiceNone,
			})
			if err != nil {
				return nil, errors.Wrap(err, "chat model generation failed")
			}
			content := stripPseudoToolXML(resp.Text)
			if content == "" {
				content = summarizeApproved(updated)
			}
			return &AssistantResponse{Content: content, ToolMessages: updated}, nil
		}
	}

	for round := 0; round < maxToolRounds; round++ {
		// Expose tools only when the registry has any.
		var toolSpecs []chat.ToolSpec
		if len(registry.All()) > 0 {
			toolSpecs = registry.Specs()
		}

		resp, err := model.Generate(ctx, chat.Request{
			Model:      req.Model,
			System:     req.System,
			Messages:   messages,
			Tools:      toolSpecs,
			ToolChoice: chat.ToolChoiceAuto,
		})
		if err != nil {
			return nil, errors.Wrap(err, "chat model generation failed")
		}

		// No tool calls → final answer.
		if len(resp.ToolCalls) == 0 {
			return &AssistantResponse{Content: resp.Text}, nil
		}

		// Execute each requested tool and collect results.
		var pending []chat.ToolCall
		toolMessages := make([]chat.Message, 0, len(resp.ToolCalls))
		hitConfirmation := false
		for _, tc := range resp.ToolCalls {
			tool := registry.Get(tc.Name)
			if tool == nil {
				toolMessages = append(toolMessages, chat.Message{
					Role:       chat.RoleTool,
					ToolCallID: tc.ID,
					Name:       tc.Name,
					Content:    fmt.Sprintf("error: unknown tool %q", tc.Name),
				})
				continue
			}

			// Determine if this tool call needs confirmation and whether it was
			// already approved. A sensitive tool must NOT execute until the user
			// approves it: we gate on the static RequiresConfirmation() so we never
			// invoke Run before approval (no side effects happen prematurely).
			requiresConfirm := tool.RequiresConfirmation(tc.ArgumentsJSON)
			if requiresConfirm && !approved[tc.ID] {
				pending = append(pending, tc)
				hitConfirmation = true
				// Do not execute yet; record the call as awaiting approval.
				toolMessages = append(toolMessages, chat.Message{
					Role:       chat.RoleTool,
					ToolCallID: tc.ID,
					Name:       tc.Name,
					Content:    awaitingConfirmationPlaceholder,
				})
				continue
			}

			// Either the tool is not sensitive, or it was already approved: execute
			// it now and capture the real result.
			result, execErr := tool.Run(ctx, req.ToolContext, tc.ArgumentsJSON)
			if execErr != nil {
				result = fmt.Sprintf("error: %v", execErr)
			}
			toolMessages = append(toolMessages, chat.Message{
				Role:       chat.RoleTool,
				ToolCallID: tc.ID,
				Name:       tc.Name,
				Content:    result,
			})
		}

		// Append the assistant tool-call turn and the tool results.
		assistantMsg := chat.Message{Role: chat.RoleAssistant, Content: resp.Text, ToolCalls: resp.ToolCalls}
		messages = append(messages, assistantMsg)
		messages = append(messages, toolMessages...)

		if hitConfirmation {
			// Return the pending calls so the caller can ask for confirmation.
			// Include the tool messages (with the "awaiting confirmation"
			// placeholders) so the caller can persist them and rebuild a
			// complete history on the next turn.
			return &AssistantResponse{
				ToolCalls:            pending,
				ToolMessages:         toolMessages,
				RequiresConfirmation: true,
			}, nil
		}
		// Otherwise loop again with the tool results in context.
	}

	// Exhausted rounds without a final answer.
	return &AssistantResponse{
		ToolCalls: respToolCallsFromMessages(messages),
	}, nil
}

// applyApprovedResults fulfills a prior confirmation: for each tool message whose
// id is in the approved set, it runs the corresponding tool and overwrites the
// placeholder ("awaiting user confirmation") content in place. Because the tool
// message stays in its original position (immediately after the assistant
// tool_calls turn), the resulting history remains valid for the provider. It
// returns the messages that were updated so the caller can surface them.
func applyApprovedResults(ctx context.Context, req *AssistantRequest, registry *tools.Registry, approved map[string]bool, approvals map[string]string, messages []chat.Message) []chat.Message {
	// Index tool-call arguments by id so we can find the args for each
	// approved tool message regardless of where it sits in the history.
	argsByID := make(map[string]string)
	for _, m := range messages {
		for _, tc := range m.ToolCalls {
			argsByID[tc.ID] = tc.ArgumentsJSON
		}
	}

	updated := make([]chat.Message, 0)
	for i := range messages {
		if messages[i].Role != chat.RoleTool || !approved[messages[i].ToolCallID] {
			continue
		}
		tool := registry.Get(messages[i].Name)
		if tool == nil {
			messages[i].Content = fmt.Sprintf("error: unknown tool %q", messages[i].Name)
			updated = append(updated, messages[i])
			continue
		}
		// Inject the user's typed confirmation keyword (if any) so write-gated
		// tools can verify it before mutating anything.
		argsJSON := argsByID[messages[i].ToolCallID]
		argsJSON = injectConfirmKeyword(argsJSON, approvals[messages[i].ToolCallID])
		result, execErr := tool.Run(ctx, req.ToolContext, argsJSON)
		if execErr != nil {
			result = fmt.Sprintf("error: %v", execErr)
		}
		messages[i].Content = result
		updated = append(updated, messages[i])
	}
	return updated
}

// applyRejectedResults marks tool messages whose ids were explicitly rejected
// by the user: their pending placeholder is replaced with a skipped note so the
// history stays complete and the follow-up summary reflects the decision. It
// returns the messages that were updated.
func applyRejectedResults(messages []chat.Message, rejected map[string]bool) []chat.Message {
	updated := make([]chat.Message, 0)
	for i := range messages {
		if messages[i].Role != chat.RoleTool || !rejected[messages[i].ToolCallID] {
			continue
		}
		if strings.TrimSpace(messages[i].Content) == awaitingConfirmationPlaceholder {
			messages[i].Content = "用户拒绝了该操作，未执行。"
		}
		updated = append(updated, messages[i])
	}
	return updated
}

// injectConfirmKeyword adds the user's typed confirmation keyword to a tool
// call's arguments so a second-factor-gated tool can verify it. Non-JSON
// arguments or an empty keyword are returned unchanged.
func injectConfirmKeyword(argsJSON, keyword string) string {
	if keyword == "" {
		return argsJSON
	}
	var args map[string]any
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return argsJSON
	}
	args["confirm_keyword"] = keyword
	raw, err := json.Marshal(args)
	if err != nil {
		return argsJSON
	}
	return string(raw)
}

var (
	pseudoToolCallBlockRe = regexp.MustCompile(`(?is)<tool_calls\b[^>]*>.*?</tool_calls>`)
	pseudoInvokeBlockRe   = regexp.MustCompile(`(?is)<invoke\b[^>]*>.*?</invoke>`)
)

// stripPseudoToolXML removes tool-call XML that some models emit as plain text
// instead of a native function call. Used as a last-resort guard on the
// approval continuation so raw XML never reaches the user.
func stripPseudoToolXML(content string) string {
	cleaned := pseudoToolCallBlockRe.ReplaceAllString(content, "")
	cleaned = pseudoInvokeBlockRe.ReplaceAllString(cleaned, "")
	return strings.TrimSpace(cleaned)
}

// summarizeApproved builds a neutral completion line from the tool messages
// whose results were written back, used when the model produces no usable text
// (e.g. it only echoed XML that was stripped).
func summarizeApproved(updated []chat.Message) string {
	if len(updated) == 1 {
		return fmt.Sprintf("已完成：%s", updated[0].Content)
	}
	return "已完成相关操作。"
}

// flattenHistory converts a message list into a purely conversational form:
// assistant tool-call turns are dropped (their prose kept when present) and
// tool-result messages become neutral system notes. This removes every trace
// of the function-calling protocol from what the model sees, so a follow-up
// generation cannot mimic pseudo-XML tool calls.
func flattenHistory(messages []chat.Message) []chat.Message {
	out := make([]chat.Message, 0, len(messages))
	for _, m := range messages {
		switch m.Role {
		case chat.RoleTool:
			name := m.Name
			if name == "" {
				name = "tool"
			}
			out = append(out, chat.Message{
				Role:    chat.RoleSystem,
				Content: fmt.Sprintf("[工具 %s] %s", name, m.Content),
			})
		case chat.RoleAssistant:
			if len(m.ToolCalls) > 0 {
				if strings.TrimSpace(m.Content) != "" {
					out = append(out, chat.Message{Role: chat.RoleAssistant, Content: m.Content})
				}
			} else {
				out = append(out, m)
			}
		default:
			out = append(out, m)
		}
	}
	return out
}

// respToolCallsFromMessages extracts the last assistant tool-call turn so the
// caller can surface what the model attempted.
func respToolCallsFromMessages(messages []chat.Message) []chat.ToolCall {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == chat.RoleAssistant && len(messages[i].ToolCalls) > 0 {
			return messages[i].ToolCalls
		}
	}
	return nil
}

func toSet(ids []string) map[string]bool {
	m := make(map[string]bool, len(ids))
	for _, id := range ids {
		m[strings.TrimSpace(id)] = true
	}
	return m
}

// MarshalToolCallArgs is a small helper for tool implementations to re-emit
// arguments unchanged when needed.
func MarshalToolCallArgs(v any) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", errors.Wrap(err, "failed to marshal tool args")
	}
	return string(raw), nil
}
