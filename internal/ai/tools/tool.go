// Package tools defines the function-calling tool abstraction used by the AI
// chat assistant. Each tool wraps an existing store capability (memos,
// comments, settings, agents, taggers) and exposes it to the model through a
// provider-agnostic ToolSpec. The assistant package drives tool execution via
// the Registry.
package tools

import (
	"context"

	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/store"
)

// ToolContext carries the request-scoped state every tool needs: the calling
// user (for visibility/ownership checks) and the store facade.
type ToolContext struct {
	UserID int32
	Store  *store.Store
}

// Tool is a single function-calling capability exposed to the model.
type Tool interface {
	// Spec returns the provider-agnostic description used to build the model's
	// tool list. Name must be unique across the registry.
	Spec() chat.ToolSpec
	// RequiresConfirmation reports whether executing this tool with the given
	// arguments has side effects that the user must approve first. The assistant
	// uses this to gate the call behind a confirmation step without invoking Run
	// (so no side effects happen before approval). Implementations may inspect
	// argsJSON to distinguish read-only from mutating operations.
	RequiresConfirmation(argsJSON string) bool
	// Run executes the tool with the model-supplied JSON arguments. It returns
	// the textual result for the model and any execution error.
	Run(ctx context.Context, tc ToolContext, argsJSON string) (result string, err error)
}

// Registry holds the available tools keyed by name.
type Registry struct {
	tools map[string]Tool
}

// NewRegistry builds a registry pre-populated with the conversational tool set.
func NewRegistry() *Registry {
	r := &Registry{tools: make(map[string]Tool)}
	for _, t := range []Tool{
		&SearchMemosTool{},
		&GetMemoTool{},
		&GetCommentsTool{},
		&CreateMemoTool{},
		&UpdateMemoTool{},
		&TagMemoTool{},
		&BatchUpdateMemosTool{},
		&DeleteMemoTool{},
		&ManageSettingsTool{},
		&QueryDBTool{},
		&GetLogsTool{},
		&ManageMemoryTool{},
		&QueryQueueTool{},
		&ProjectStatusTool{},
	} {
		r.tools[t.Spec().Name] = t
	}
	return r
}

// Get returns the tool with the given name, or nil if absent.
func (r *Registry) Get(name string) Tool {
	return r.tools[name]
}

// All returns every registered tool.
func (r *Registry) All() []Tool {
	out := make([]Tool, 0, len(r.tools))
	for _, t := range r.tools {
		out = append(out, t)
	}
	return out
}

// Register adds (or replaces) a tool in the registry. It is primarily used by
// tests to inject fakes without depending on store backends.
func (r *Registry) Register(t Tool) {
	r.tools[t.Spec().Name] = t
}

// Remove deletes a tool from the registry so the model never sees it.
func (r *Registry) Remove(name string) {
	delete(r.tools, name)
}

// Specs returns the ToolSpec for every registered tool, suitable for sending to
// a chat.Model.
func (r *Registry) Specs() []chat.ToolSpec {
	out := make([]chat.ToolSpec, 0, len(r.tools))
	for _, t := range r.tools {
		out = append(out, t.Spec())
	}
	return out
}
