package v1

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

// These tests exercise the internal scheduling logic directly (the unexported
// scheduleAutoTagForMemo), which is also reachable via the public AutoTagMemo
// RPC covered in the api/v1/test package.

func newTaggerTestStore(t *testing.T) (*store.Store, func()) {
	ctx := context.Background()
	ts := teststore.NewTestingStore(ctx, t)
	// Ensure an admin exists so memos can be created.
	if _, err := ts.CreateUser(ctx, &store.User{
		Username: "tagger-test-admin",
		Role:     store.RoleAdmin,
		Email:    "tagger-test-admin@example.com",
	}); err != nil {
		t.Fatal(err)
	}
	return ts, func() { ts.Close() }
}

func upsertTaggerSetting(t *testing.T, s *store.Store, taggers ...*storepb.TaggerConfig) {
	ctx := context.Background()
	_, err := s.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{
			AiSetting: &storepb.InstanceAISetting{
				Providers: []*storepb.AIProviderConfig{
					{Id: "prov-1", Title: "P", Type: storepb.AIProviderType_OPENAI, ApiKey: "sk-test"},
				},
				Taggers: taggers,
			},
		},
	})
	require.NoError(t, err)
}

func TestScheduleAutoTagForMemoSchedulesForUntaggedMemo(t *testing.T) {
	s, cleanup := newTaggerTestStore(t)
	defer cleanup()
	ctx := context.Background()

	upsertTaggerSetting(t, s,
		&storepb.TaggerConfig{Id: "tagger-1", Name: "T1", ProviderId: "prov-1", Enabled: true, Prompt: "candidates: work, life", MaxTags: 3},
		&storepb.TaggerConfig{Id: "tagger-2", Name: "T2", ProviderId: "prov-1", Enabled: true, Prompt: "candidates: idea", MaxTags: 3},
	)

	memo, err := s.CreateMemo(ctx, &store.Memo{
		UID:        "untagged",
		CreatorID:  1,
		Content:    "untagged memo",
		Visibility: store.Public,
	})
	require.NoError(t, err)

	svc := &APIV1Service{Store: s}
	svc.scheduleAutoTagForMemo(ctx, memo.ID)

	tasks, err := s.ListMemoTagTasks(ctx, &store.FindMemoTagTask{MemoID: &memo.ID})
	require.NoError(t, err)
	require.Len(t, tasks, 2, "one task per enabled tagger for an untagged memo")
}

func TestScheduleAutoTagForMemoSkipsTaggedMemo(t *testing.T) {
	s, cleanup := newTaggerTestStore(t)
	defer cleanup()
	ctx := context.Background()

	upsertTaggerSetting(t, s,
		&storepb.TaggerConfig{Id: "tagger-1", Name: "T1", ProviderId: "prov-1", Enabled: true, Prompt: "candidates: work", MaxTags: 3},
	)

	memo, err := s.CreateMemo(ctx, &store.Memo{
		UID:        "tagged",
		CreatorID:  1,
		Content:    "already tagged",
		Visibility: store.Public,
		Payload:    &storepb.MemoPayload{Tags: []string{"life"}},
	})
	require.NoError(t, err)

	svc := &APIV1Service{Store: s}
	svc.scheduleAutoTagForMemo(ctx, memo.ID)

	tasks, err := s.ListMemoTagTasks(ctx, &store.FindMemoTagTask{MemoID: &memo.ID})
	require.NoError(t, err)
	require.Len(t, tasks, 0, "no task for a memo that already has tags")
}

func TestScheduleAutoTagForMemoSkipsDisabledTagger(t *testing.T) {
	s, cleanup := newTaggerTestStore(t)
	defer cleanup()
	ctx := context.Background()

	upsertTaggerSetting(t, s,
		&storepb.TaggerConfig{Id: "tagger-off", Name: "Off", ProviderId: "prov-1", Enabled: false, Prompt: "candidates: work", MaxTags: 3},
		&storepb.TaggerConfig{Id: "tagger-no-prov", Name: "NoProv", ProviderId: "", Enabled: true, Prompt: "candidates: work", MaxTags: 3},
	)

	memo, err := s.CreateMemo(ctx, &store.Memo{
		UID:        "no-enabled",
		CreatorID:  1,
		Content:    "no enabled tagger",
		Visibility: store.Public,
	})
	require.NoError(t, err)

	svc := &APIV1Service{Store: s}
	svc.scheduleAutoTagForMemo(ctx, memo.ID)

	tasks, err := s.ListMemoTagTasks(ctx, &store.FindMemoTagTask{MemoID: &memo.ID})
	require.NoError(t, err)
	require.Len(t, tasks, 0, "disabled / provider-less taggers must not be scheduled")
}
