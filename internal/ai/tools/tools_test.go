package tools_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/ai/tools"
)

func TestRegistryContainsAllStage1Tools(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	got := make(map[string]bool)
	for _, spec := range r.Specs() {
		got[spec.Name] = true
	}
	for _, name := range []string{
		"search_memos",
		"get_comments",
		"create_memo",
		"manage_settings",
		"agent_reply",
		"auto_tag",
		"query_db",
		"get_logs",
	} {
		require.Truef(t, got[name], "registry missing tool %q", name)
	}
	// Names must be unique.
	require.Len(t, r.Specs(), len(got))
}

func TestRegistryRemove(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	require.NotNil(t, r.Get("get_logs"))
	r.Remove("get_logs")
	require.Nil(t, r.Get("get_logs"))
	for _, spec := range r.Specs() {
		require.NotEqual(t, "get_logs", spec.Name)
	}
	// Removing a name that is not registered is a no-op.
	r.Remove("does-not-exist")
}

func TestToolsRejectMissingRequiredArgs(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	ctx := context.Background()
	// Store is nil: tool implementations must validate required args before
	// touching the store, so these should return an error, not panic.
	tc := tools.ToolContext{UserID: 1, Store: nil}

	cases := []struct {
		name string
		args string
	}{
		{"get_comments", `{"limit":5}`},            // missing memoUid
		{"create_memo", `{"visibility":"PUBLIC"}`}, // missing content
		{"delete_memo", `{}`},                      // missing memoUid
		{"agent_reply", `{}`},                      // missing memoUid
		{"auto_tag", `{}`},                         // missing memoUid
		{"manage_settings", `{"key":"GENERAL"}`},   // missing action
	}
	for _, c := range cases {
		tool := r.Get(c.name)
		require.NotNil(t, tool, c.name)
		_, err := tool.Run(ctx, tc, c.args)
		require.Error(t, err, "tool %s should reject missing required args", c.name)
	}
}

func TestManageSettingsRejectsUnknownKey(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	tool := r.Get("manage_settings")
	require.NotNil(t, tool)
	_, err := tool.Run(context.Background(), tools.ToolContext{UserID: 1, Store: nil}, `{"action":"get","key":"NOPE"}`)
	require.Error(t, err)
}
