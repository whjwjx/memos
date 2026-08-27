package tools_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/ai/tools"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/test"
)

func TestGetLogsWithStore(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	admin := createQueryDBTestUser(t, ctx, s, "logs-admin", store.RoleAdmin)
	normal := createQueryDBTestUser(t, ctx, s, "logs-user", store.RoleUser)

	// Write a synthetic daily log file under the store's data directory.
	logsDir := filepath.Join(s.GetDataDir(), "logs")
	require.NoError(t, os.MkdirAll(logsDir, 0o755))
	now := time.Now().Format("2006-01-02")
	logContent := "time=2026-08-27T10:00:00Z level=INFO msg=\"started\"\n" +
		"time=2026-08-27T10:01:00Z level=ERROR msg=\"request failed\" apiKey=sk-123456789 secret=abc token=xyz\n"
	require.NoError(t, os.WriteFile(filepath.Join(logsDir, "memos-"+now+".log"), []byte(logContent), 0o644))

	tool := tools.NewRegistry().Get("get_logs")
	require.NotNil(t, tool)

	// Non-admin users are rejected.
	_, err := tool.Run(ctx, tools.ToolContext{UserID: normal.ID, Store: s}, `{"limit":10}`)
	require.Error(t, err)
	require.Contains(t, err.Error(), "admin")

	// Admin reads the tail and sensitive values are redacted (the key itself is
	// kept, the value is masked).
	result, err := tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s}, `{"limit":10}`)
	require.NoError(t, err)
	require.Contains(t, result, "started")
	require.Contains(t, result, "apiKey=***")
	require.Contains(t, result, "secret=***")
	require.NotContains(t, result, "sk-123456789")

	// Level filter keeps only matching severities.
	result, err = tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s}, `{"level":"ERROR"}`)
	require.NoError(t, err)
	require.Contains(t, result, "request failed")
	require.NotContains(t, result, "started")

	// Invalid level is rejected.
	_, err = tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s}, `{"level":"nope"}`)
	require.Error(t, err)

	// Invalid since timestamp is rejected.
	_, err = tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s}, `{"since":"not-a-time"}`)
	require.Error(t, err)

	// Argument validation happens before touching the store.
	_, err = tool.Run(context.Background(), tools.ToolContext{UserID: 1, Store: nil}, `{"limit":0}`)
	require.Error(t, err)
}
