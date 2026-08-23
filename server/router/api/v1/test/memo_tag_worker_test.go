package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"strings"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
)

// upsertTestAISetting writes an AI setting with the supplied taggers (and a
// dummy provider so taggers can reference it) straight to the store.
func upsertTestAISetting(ctx context.Context, t *testing.T, ts *TestService, taggers ...*storepb.TaggerConfig) {
	t.Helper()
	_, err := ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{
			AiSetting: &storepb.InstanceAISetting{
				Providers: []*storepb.AIProviderConfig{
					{
						Id:     "prov-1",
						Title:  "TestProvider",
						Type:   storepb.AIProviderType_OPENAI,
						ApiKey: "sk-test",
					},
				},
				Taggers: taggers,
			},
		},
	})
	require.NoError(t, err)
}

func createTestMemo(ctx context.Context, t *testing.T, ts *TestService, creatorID int32, content string, tags []string) *store.Memo {
	t.Helper()
	memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "memo-" + strings.ReplaceAll(content, " ", "-"),
		CreatorID:  creatorID,
		Content:    content,
		Visibility: store.Public,
		Payload:    &storepb.MemoPayload{Tags: tags},
	})
	require.NoError(t, err)
	return memo
}

func TestParseTaggerCandidateTags(t *testing.T) {
	cases := []struct {
		name   string
		prompt string
		want   []string
	}{
		{"comma separated with hash", "candidates: work, life, #idea", []string{"work", "life", "idea"}},
		{"newline separated", "work\nlife\nproject", []string{"work", "life", "project"}},
		{"bullet list", "- work\n- life", []string{"work", "life"}},
		{"quoted and mixed separators", "work, life，idea、learning", []string{"work", "life", "idea", "learning"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			set := v1.ParseTaggerCandidateTags(tc.prompt)
			for _, w := range tc.want {
				require.True(t, set[w], "expected candidate %q in set", w)
			}
		})
	}
}

// TestAutoTagMemoRPC schedules tasks via the public RPC path, ensuring the
// wired-up handler (not just the internal method) queues work.
func TestAutoTagMemoRPC(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	host, err := ts.CreateHostUser(ctx, "autotag-rpc-admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, host.ID)

	upsertTestAISetting(ctx, t, ts,
		&storepb.TaggerConfig{Id: "tagger-1", Name: "T1", ProviderId: "prov-1", Enabled: true, Prompt: "candidates: work, life", MaxTags: 3},
	)

	memo := createTestMemo(ctx, t, ts, host.ID, "rpc memo", nil)

	_, err = ts.Service.AutoTagMemo(adminCtx, &v1pb.AutoTagMemoRequest{
		Name: "memos/" + memo.UID,
	})
	require.NoError(t, err)

	tasks, err := ts.Store.ListMemoTagTasks(ctx, &store.FindMemoTagTask{MemoID: &memo.ID})
	require.NoError(t, err)
	require.Len(t, tasks, 1)
}
