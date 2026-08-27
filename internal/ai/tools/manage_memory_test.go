package tools_test

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/ai/tools"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/test"
)

func TestManageMemoryRequiresConfirmation(t *testing.T) {
	t.Parallel()
	tool := tools.NewRegistry().Get("manage_memory")
	require.NotNil(t, tool)

	// Reading the memory bank has no side effects.
	require.False(t, tool.RequiresConfirmation(`{"operation":"list"}`))
	// Every write operation is gated behind confirmation.
	for _, op := range []string{"add", "update", "delete"} {
		require.Truef(t, tool.RequiresConfirmation(`{"operation":"`+op+`","content":"x"}`), "operation %s", op)
	}
	// Unparseable arguments never ask for confirmation.
	require.False(t, tool.RequiresConfirmation(`not-json`))
}

func TestManageMemoryAdminOnly(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	normal := createQueryDBTestUser(t, ctx, s, "mem-user", store.RoleUser)
	tool := tools.NewRegistry().Get("manage_memory")
	require.NotNil(t, tool)

	_, err := tool.Run(ctx, tools.ToolContext{UserID: normal.ID, Store: s}, `{"operation":"list"}`)
	require.Error(t, err)
	require.Contains(t, err.Error(), "admin")
}

func TestManageMemoryCRUD(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	admin := createQueryDBTestUser(t, ctx, s, "mem-admin", store.RoleAdmin)
	tool := tools.NewRegistry().Get("manage_memory")
	require.NotNil(t, tool)
	tc := tools.ToolContext{UserID: admin.ID, Store: s}

	// Empty list.
	result, err := tool.Run(ctx, tc, `{"operation":"list"}`)
	require.NoError(t, err)
	require.Contains(t, result, "empty")

	// Add two entries.
	result, err = tool.Run(ctx, tc, `{"operation":"add","content":"The instance is deployed on Tencent Cloud."}`)
	require.NoError(t, err)
	require.Contains(t, result, "Tencent Cloud")

	result, err = tool.Run(ctx, tc, `{"operation":"add","content":"Deployments happen on Fridays."}`)
	require.NoError(t, err)
	require.Contains(t, result, "Fridays")

	// List returns both entries with their ids.
	result, err = tool.Run(ctx, tc, `{"operation":"list"}`)
	require.NoError(t, err)
	require.Contains(t, result, "Tencent Cloud")
	require.Contains(t, result, "Fridays")

	// Extract an entry id to update/delete.
	lines := strings.Split(strings.TrimSpace(result), "\n")
	require.Len(t, lines, 2)
	id := ""
	for _, line := range lines {
		if strings.Contains(line, "Fridays") {
			start := strings.Index(line, "[")
			end := strings.Index(line, "]")
			require.Greater(t, start, -1)
			require.Greater(t, end, start)
			id = line[start+1 : end]
		}
	}
	require.NotEmpty(t, id)

	// Update.
	result, err = tool.Run(ctx, tc, `{"operation":"update","id":"`+id+`","content":"Deployments happen on Tuesdays."}`)
	require.NoError(t, err)
	require.Contains(t, result, "updated")
	result, err = tool.Run(ctx, tc, `{"operation":"list"}`)
	require.NoError(t, err)
	require.Contains(t, result, "Tuesdays")
	require.NotContains(t, result, "Fridays")

	// Delete.
	result, err = tool.Run(ctx, tc, `{"operation":"delete","id":"`+id+`"}`)
	require.NoError(t, err)
	require.Contains(t, result, "deleted")
	result, err = tool.Run(ctx, tc, `{"operation":"list"}`)
	require.NoError(t, err)
	require.NotContains(t, result, "Tuesdays")
	require.Contains(t, result, "Tencent Cloud")

	// The mutation is persisted in the instance AI setting.
	setting, err := s.GetInstanceAISetting(ctx)
	require.NoError(t, err)
	require.NotNil(t, setting.GetMemory())
	require.Len(t, setting.GetMemory().GetEntries(), 1)
	require.Equal(t, admin.Username, setting.GetMemory().GetEntries()[0].GetCreatedBy())
}

func TestManageMemoryValidation(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	admin := createQueryDBTestUser(t, ctx, s, "mem-val-admin", store.RoleAdmin)
	tool := tools.NewRegistry().Get("manage_memory")
	require.NotNil(t, tool)
	tc := tools.ToolContext{UserID: admin.ID, Store: s}

	cases := []string{
		`{}`,                            // missing operation
		`{"operation":"nope"}`,          // unknown operation
		`{"operation":"add"}`,           // add without content
		`{"operation":"update","id":"1"}`,   // update without content
		`{"operation":"update","content":"x"}`, // update without id
		`{"operation":"delete"}`,        // delete without id
		`{"operation":"delete","id":"missing-id"}`, // unknown id
		`{"operation":"update","id":"missing-id","content":"x"}`, // unknown id
	}
	for _, args := range cases {
		_, err := tool.Run(ctx, tc, args)
		require.Error(t, err, "args: %s", args)
	}

	// Missing store.
	_, err := tool.Run(context.Background(), tools.ToolContext{UserID: admin.ID}, `{"operation":"list"}`)
	require.Error(t, err)
}
