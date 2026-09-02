package tools_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/ai/tools"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/test"
)

func TestAdminStatusToolsRequireNoConfirmation(t *testing.T) {
	t.Parallel()
	registry := tools.NewRegistry()

	queryQueue := registry.Get("query_queue")
	require.NotNil(t, queryQueue)
	require.False(t, queryQueue.RequiresConfirmation(`{"queue":"agent_reply_task"}`))

	projectStatus := registry.Get("project_status")
	require.NotNil(t, projectStatus)
	require.False(t, projectStatus.RequiresConfirmation(`{"includeTableCounts":true}`))
}

func TestQueryQueueAdminOnlyAndOutput(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	admin := createQueryDBTestUser(t, ctx, s, "queue-admin", store.RoleAdmin)
	normal := createQueryDBTestUser(t, ctx, s, "queue-user", store.RoleUser)
	tool := tools.NewRegistry().Get("query_queue")
	require.NotNil(t, tool)

	memo, err := s.CreateMemo(ctx, &store.Memo{
		UID:        "queue-memo-1",
		CreatorID:  admin.ID,
		Content:    "queued memo",
		Visibility: store.Public,
	})
	require.NoError(t, err)
	_, err = s.UpsertAgentReplyTask(ctx, &store.CreateAgentReplyTask{
		MemoID:  memo.ID,
		AgentID: "agent-1",
		DueAt:   123,
	})
	require.NoError(t, err)
	_, err = s.UpsertMemoTagTask(ctx, &store.CreateMemoTagTask{
		MemoID:   memo.ID,
		TaggerID: "tagger-1",
		DueAt:    456,
	})
	require.NoError(t, err)

	_, err = tool.Run(ctx, tools.ToolContext{UserID: normal.ID, Store: s}, `{}`)
	require.Error(t, err)
	require.Contains(t, err.Error(), "admin")

	result, err := tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s}, `{"status":"PENDING","memoUid":"queue-memo-1"}`)
	require.NoError(t, err)
	require.Contains(t, result, "agent_reply_task")
	require.Contains(t, result, "memo_tag_task")
	require.Contains(t, result, "agent-1")
	require.Contains(t, result, "tagger-1")
	require.Contains(t, result, "PENDING")

	_, err = tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s}, `{"queue":"unknown"}`)
	require.Error(t, err)
	_, err = tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s}, `{"status":"UNKNOWN"}`)
	require.Error(t, err)
}

func TestProjectStatusAdminOnlyAndOutput(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	admin := createQueryDBTestUser(t, ctx, s, "status-admin", store.RoleAdmin)
	normal := createQueryDBTestUser(t, ctx, s, "status-user", store.RoleUser)
	tool := tools.NewRegistry().Get("project_status")
	require.NotNil(t, tool)

	_, err := s.CreateMemo(ctx, &store.Memo{
		UID:        "status-memo-1",
		CreatorID:  admin.ID,
		Content:    "status memo",
		Visibility: store.Public,
	})
	require.NoError(t, err)
	_, err = s.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{
			Providers: []*storepb.AIProviderConfig{
				{Id: "provider-1", Title: "Test Provider", Type: storepb.AIProviderType_OPENAI, ApiKey: "secret-key"},
			},
			ChatAgents: []*storepb.ChatAgentConfig{
				{Id: "default", Name: "Default", ProviderId: "provider-1", Enabled: true},
			},
			Tools: map[string]*storepb.ToolConfig{
				"query_queue": {Enabled: true},
			},
		}},
	})
	require.NoError(t, err)
	logsDir := filepath.Join(s.GetDataDir(), "logs")
	require.NoError(t, os.MkdirAll(logsDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(logsDir, "memos-test.log"), []byte("level=info msg=test\n"), 0644))

	_, err = tool.Run(ctx, tools.ToolContext{UserID: normal.ID, Store: s}, `{}`)
	require.Error(t, err)
	require.Contains(t, err.Error(), "admin")

	result, err := tool.Run(ctx, tools.ToolContext{UserID: admin.ID, Store: s}, `{"includeTableCounts":true}`)
	require.NoError(t, err)
	require.Contains(t, result, `"database"`)
	require.Contains(t, result, `"tableCounts"`)
	require.Contains(t, result, `"queues"`)
	require.Contains(t, result, `"ai"`)
	require.Contains(t, result, `"logs"`)
	require.Contains(t, result, `"providersWithApiKey":1`)
	require.NotContains(t, result, "secret-key")
}
