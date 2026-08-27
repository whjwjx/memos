package assistant

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/internal/ai/tools"
)

// fakeModel returns queued responses in order, then a final text response. The
// last request is recorded so tests can assert what was sent to the provider.
type fakeModel struct {
	responses []*chat.Response
	idx       int
	lastReq   chat.Request
}

func (m *fakeModel) Generate(_ context.Context, req chat.Request) (*chat.Response, error) {
	m.lastReq = req
	if m.idx >= len(m.responses) {
		return &chat.Response{Text: "done"}, nil
	}
	r := m.responses[m.idx]
	m.idx++
	return r, nil
}

// fakeTool is a tool whose Run returns a fixed result and optional confirmation.
type fakeTool struct {
	name     string
	confirm  bool
	executed *bool
}

func (f *fakeTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{Name: f.name, Description: "fake", ParametersJSON: `{"type":"object","properties":{}}`}
}

func (f *fakeTool) RequiresConfirmation(_ string) bool {
	return f.confirm
}

func (f *fakeTool) Run(_ context.Context, _ tools.ToolContext, _ string) (string, error) {
	if f.executed != nil {
		*f.executed = true
	}
	return "ok", nil
}

func newRegistryWith(tool tools.Tool) *tools.Registry {
	r := tools.NewRegistry()
	r.Register(tool)
	return r
}

func TestRunLoopExecutesToolThenAnswers(t *testing.T) {
	t.Parallel()
	executed := false
	model := &fakeModel{
		responses: []*chat.Response{
			{ToolCalls: []chat.ToolCall{{ID: "c1", Name: "search_memos", ArgumentsJSON: `{"query":"hi"}`}}},
			{Text: "here are your notes"},
		},
	}
	reg := newRegistryWith(&fakeTool{name: "search_memos", executed: &executed})
	resp, err := runLoop(context.Background(), model, &AssistantRequest{
		Registry:    reg,
		UserContent: "find my notes",
	})
	require.NoError(t, err)
	require.True(t, executed)
	require.Equal(t, "here are your notes", resp.Content)
	require.False(t, resp.RequiresConfirmation)
}

func TestRunLoopStopsAtConfirmation(t *testing.T) {
	t.Parallel()
	model := &fakeModel{
		responses: []*chat.Response{
			{ToolCalls: []chat.ToolCall{{ID: "c2", Name: "manage_settings", ArgumentsJSON: `{}`}}},
		},
	}
	reg := newRegistryWith(&fakeTool{name: "manage_settings", confirm: true})
	resp, err := runLoop(context.Background(), model, &AssistantRequest{
		Registry:    reg,
		UserContent: "update my settings",
	})
	require.NoError(t, err)
	require.True(t, resp.RequiresConfirmation)
	require.Len(t, resp.ToolCalls, 1)
	require.Equal(t, "manage_settings", resp.ToolCalls[0].Name)
}

func TestRunLoopContinuesAfterApproval(t *testing.T) {
	t.Parallel()
	executed := false
	model := &fakeModel{
		responses: []*chat.Response{
			{Text: "settings updated"},
		},
	}
	reg := newRegistryWith(&fakeTool{name: "manage_settings", confirm: true, executed: &executed})
	resp, err := runLoop(context.Background(), model, &AssistantRequest{
		Registry: reg,
		// Prior turn: the model requested a sensitive tool that is still
		// awaiting user confirmation.
		History: []chat.Message{
			{Role: chat.RoleAssistant, ToolCalls: []chat.ToolCall{{ID: "c2", Name: "manage_settings", ArgumentsJSON: `{}`}}},
			{Role: chat.RoleTool, ToolCallID: "c2", Name: "manage_settings", Content: "awaiting user confirmation"},
		},
		UserContent:         "[user approved the pending tool, please execute and continue]",
		ApprovedToolCallIDs: []string{"c2"},
	})
	require.NoError(t, err)
	require.True(t, executed)
	require.False(t, resp.RequiresConfirmation)
	require.Equal(t, "settings updated", resp.Content)
	// The approval continuation strips every function-calling trace: no tool
	// definitions are sent (so no tool_choice is issued at all) and the history
	// is flattened so the model cannot mimic pseudo-XML tool calls.
	require.Equal(t, chat.ToolChoiceNone, model.lastReq.ToolChoice)
	require.Empty(t, model.lastReq.Tools)
	for _, m := range model.lastReq.Messages {
		require.NotEqual(t, chat.RoleTool, m.Role)
	}
}

func TestRunLoopApprovalExecutesApprovedAndSkipsRejected(t *testing.T) {
	t.Parallel()
	executed := false
	model := &fakeModel{
		responses: []*chat.Response{
			{Text: "第一个已执行，第二个已跳过。"},
		},
	}
	reg := newRegistryWith(&fakeTool{name: "manage_settings", confirm: true, executed: &executed})
	resp, err := runLoop(context.Background(), model, &AssistantRequest{
		Registry: reg,
		History: []chat.Message{
			{Role: chat.RoleAssistant, ToolCalls: []chat.ToolCall{
				{ID: "c1", Name: "manage_settings", ArgumentsJSON: `{}`},
				{ID: "c2", Name: "manage_settings", ArgumentsJSON: `{}`},
			}},
			{Role: chat.RoleTool, ToolCallID: "c1", Name: "manage_settings", Content: "awaiting user confirmation"},
			{Role: chat.RoleTool, ToolCallID: "c2", Name: "manage_settings", Content: "awaiting user confirmation"},
		},
		UserContent:         "[user decided the pending tools, continue]",
		ApprovedToolCallIDs: []string{"c1"},
		RejectedToolCallIDs: []string{"c2"},
	})
	require.NoError(t, err)
	require.False(t, resp.RequiresConfirmation)
	// Only the approved call ran; the rejected one was marked as skipped.
	require.True(t, executed)
	require.Equal(t, "第一个已执行，第二个已跳过。", resp.Content)
	require.Len(t, resp.ToolMessages, 2)
	for _, m := range resp.ToolMessages {
		require.NotEqual(t, "awaiting user confirmation", m.Content)
	}
}

func TestRunLoopApprovalStripsPseudoXML(t *testing.T) {
	t.Parallel()
	// The model echoes a pseudo-XML tool call instead of a summary. The loop
	// must strip it and fall back to a neutral completion line.
	model := &fakeModel{
		responses: []*chat.Response{
			{Text: "<tool_calls>\n<invoke name=\"manage_settings\">\n</invoke>\n</tool_calls>"},
		},
	}
	reg := newRegistryWith(&fakeTool{name: "manage_settings", confirm: true})
	resp, err := runLoop(context.Background(), model, &AssistantRequest{
		Registry: reg,
		History: []chat.Message{
			{Role: chat.RoleAssistant, ToolCalls: []chat.ToolCall{{ID: "c2", Name: "manage_settings", ArgumentsJSON: `{}`}}},
			{Role: chat.RoleTool, ToolCallID: "c2", Name: "manage_settings", Content: "awaiting user confirmation"},
		},
		UserContent:         "[user approved the pending tool, please execute and continue]",
		ApprovedToolCallIDs: []string{"c2"},
	})
	require.NoError(t, err)
	require.False(t, resp.RequiresConfirmation)
	// The pseudo-XML is gone; the fallback summary mentions the tool result.
	require.NotContains(t, resp.Content, "<tool_calls>")
	require.NotContains(t, resp.Content, "<invoke")
	require.NotEmpty(t, resp.Content)
	// The request sent to the model carries no tools and no tool messages.
	require.Empty(t, model.lastReq.Tools)
	for _, m := range model.lastReq.Messages {
		require.NotEqual(t, chat.RoleTool, m.Role)
	}
}

func TestRunLoopRespectsMaxRounds(t *testing.T) {
	t.Parallel()
	model := &fakeModel{
		responses: []*chat.Response{
			{ToolCalls: []chat.ToolCall{{ID: "c1", Name: "search_memos", ArgumentsJSON: `{}`}}},
		},
	}
	reg := newRegistryWith(&fakeTool{name: "search_memos"})
	resp, err := runLoop(context.Background(), model, &AssistantRequest{
		Registry:    reg,
		UserContent: "loop",
	})
	require.NoError(t, err)
	require.NotNil(t, resp)
}

func TestInjectConfirmKeyword(t *testing.T) {
	t.Parallel()
	cases := []struct {
		argsJSON string
		keyword  string
		want     string
	}{
		{`{"a":1}`, "yes", `{"a":1,"confirm_keyword":"yes"}`},
		// Empty keyword leaves the arguments untouched.
		{`{"a":1}`, "", `{"a":1}`},
		// Existing confirm_keyword is overwritten by the system value.
		{`{"a":1,"confirm_keyword":"old"}`, "yes", `{"a":1,"confirm_keyword":"yes"}`},
	}
	for _, c := range cases {
		got := injectConfirmKeyword(c.argsJSON, c.keyword)
		require.JSONEq(t, c.want, got)
	}
	// Non-JSON arguments are returned unchanged.
	require.Equal(t, "not-json", injectConfirmKeyword("not-json", "yes"))
}

// recordingTool captures the last args it was invoked with.
type recordingTool struct {
	name     string
	confirm  bool
	lastArgs string
}

func (f *recordingTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{Name: f.name, Description: "fake", ParametersJSON: `{"type":"object","properties":{}}`}
}

func (f *recordingTool) RequiresConfirmation(_ string) bool {
	return f.confirm
}

func (f *recordingTool) Run(_ context.Context, _ tools.ToolContext, argsJSON string) (string, error) {
	f.lastArgs = argsJSON
	return "ok", nil
}

func TestApplyApprovedResultsInjectsConfirmKeyword(t *testing.T) {
	t.Parallel()
	// With an approval keyword, the tool is re-invoked with confirm_keyword
	// injected into its arguments.
	tool := &recordingTool{name: "query_db", confirm: true}
	reg := newRegistryWith(tool)
	messages := []chat.Message{
		{Role: chat.RoleAssistant, ToolCalls: []chat.ToolCall{{ID: "c1", Name: "query_db", ArgumentsJSON: `{"operation":"delete","table":"memo"}`}}},
		{Role: chat.RoleTool, ToolCallID: "c1", Name: "query_db", Content: "awaiting user confirmation"},
	}
	updated := applyApprovedResults(context.Background(), &AssistantRequest{}, reg, map[string]bool{"c1": true}, map[string]string{"c1": "yes"}, messages)
	require.Len(t, updated, 1)
	require.JSONEq(t, `{"operation":"delete","table":"memo","confirm_keyword":"yes"}`, tool.lastArgs)

	// Without a keyword the arguments are passed through unchanged.
	tool2 := &recordingTool{name: "query_db", confirm: true}
	reg2 := newRegistryWith(tool2)
	applyApprovedResults(context.Background(), &AssistantRequest{}, reg2, map[string]bool{"c1": true}, nil, messages)
	require.JSONEq(t, `{"operation":"delete","table":"memo"}`, tool2.lastArgs)
}
