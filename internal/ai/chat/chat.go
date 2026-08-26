// Package chat defines the text-generation capability for AI providers.
// Implementations call chat-completions or generate-content style APIs that
// accept a list of conversation messages and return generated text. This is
// the building block for text-based AI features such as agent replies.
package chat

import (
	"context"
)

// Model invokes a text-generation LLM with a list of messages.
type Model interface {
	Generate(ctx context.Context, req Request) (*Response, error)
}

// Request is the input to a text-generation call.
type Request struct {
	// System is an optional system prompt that steers the model's behavior.
	System string
	// Messages is the ordered conversation history.
	Messages []Message
	// Model is the provider-specific model id (e.g. "gpt-4o", "gemini-2.5-flash").
	Model string
	// Temperature is optional; nil leaves the provider default in place.
	Temperature *float32
	// MaxTokens is an optional upper bound on generated tokens; zero means
	// the provider default is used.
	MaxTokens int
	// Tools is an optional set of function-calling tools the model may invoke.
	// When non-empty, providers are instructed to emit ToolCalls instead of (or
	// in addition to) free-text. The existing agent-reply path leaves this nil.
	Tools []ToolSpec
	// ToolChoice selects how the model may call tools. Empty means the provider
	// default (typically "auto"). Use ToolChoiceAuto / ToolChoiceNone /
	// ToolChoiceRequired to force behavior, or a tool name to force a specific
	// tool.
	ToolChoice string
}

// Message is a single turn in the conversation.
type Message struct {
	Role    string
	Content string
	// ToolCalls is non-empty for assistant messages that requested tool
	// invocations. It is echoed back to the model after the tool results are
	// appended as ToolMessages.
	ToolCalls []ToolCall
	// ToolCallID links a ToolMessage back to the assistant ToolCall it answers.
	ToolCallID string
	// Name is the tool name for a ToolMessage (the tool that produced Content).
	Name string
}

// ToolSpec describes a single function-calling tool in a provider-agnostic way.
type ToolSpec struct {
	// Name is the function identifier the model must echo in ToolCall.Name.
	Name string
	// Description explains when and why to call the tool.
	Description string
	// ParametersJSON is a JSON Schema object (as a raw JSON string) describing
	// the function's typed input. Providers map this to their own schema format.
	ParametersJSON string
}

// ToolCall is a model-requested invocation of a tool.
type ToolCall struct {
	// ID uniquely identifies this call so the tool result can be correlated.
	ID string
	// Name is the tool (function) the model wants to invoke.
	Name string
	// ArgumentsJSON is the JSON-encoded arguments for the call.
	ArgumentsJSON string
}

// Response is the output of a text-generation call.
type Response struct {
	Text         string
	FinishReason FinishReason
	// ToolCalls is non-empty when the model responded with function calls
	// instead of (or alongside) free-text. The caller must execute each tool
	// and append the results as ToolMessages before calling Generate again.
	ToolCalls []ToolCall
}

// Tool-choice sentinels understood by every supported provider.
const (
	ToolChoiceAuto     = "auto"
	ToolChoiceNone     = "none"
	ToolChoiceRequired = "required"
)

// FinishReason describes why the model stopped generating.
type FinishReason string

const (
	FinishStop   FinishReason = "stop"   // model finished normally
	FinishLength FinishReason = "length" // truncated by max-tokens
	FinishSafety FinishReason = "safety" // safety filter blocked output
	FinishOther  FinishReason = "other"  // anything else, including unknown
)

// Standard conversation roles.
const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
	// RoleTool is used for messages that carry the result of a tool
	// invocation; it answers a prior assistant ToolCall identified by
	// Message.ToolCallID / Message.Name.
	RoleTool = "tool"
)
