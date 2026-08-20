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
}

// Message is a single turn in the conversation.
type Message struct {
	Role    string
	Content string
}

// Response is the output of a text-generation call.
type Response struct {
	Text         string
	FinishReason FinishReason
}

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
)
