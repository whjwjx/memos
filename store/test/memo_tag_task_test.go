package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestMemoTagTaskUpsertAndIdempotency(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	if _, err := createTestingHostUser(ctx, ts); err != nil {
		t.Fatal(err)
	}

	memoID := int32(101)
	taggerID := "tagger-A"

	// First upsert creates the row.
	task1, err := ts.UpsertMemoTagTask(ctx, &store.CreateMemoTagTask{
		MemoID:   memoID,
		TaggerID: taggerID,
		DueAt:    1000,
	})
	require.NoError(t, err)
	require.NotNil(t, task1)
	require.Equal(t, store.MemoTagTaskPending, task1.Status)
	require.Equal(t, memoID, task1.MemoID)
	require.Equal(t, taggerID, task1.TaggerID)
	require.Equal(t, int64(1000), task1.DueAt)

	// Second upsert for the same (memo_id, tagger_id) must return the same row
	// id and NOT create a duplicate (idempotency via UNIQUE + ON CONFLICT).
	task2, err := ts.UpsertMemoTagTask(ctx, &store.CreateMemoTagTask{
		MemoID:   memoID,
		TaggerID: taggerID,
		DueAt:    2000,
	})
	require.NoError(t, err)
	require.Equal(t, task1.ID, task2.ID, "upsert must be idempotent for same (memo_id, tagger_id)")
	require.Equal(t, int64(2000), task2.DueAt, "due_at should be refreshed on conflict")

	all, err := ts.ListMemoTagTasks(ctx, &store.FindMemoTagTask{})
	require.NoError(t, err)
	require.Len(t, all, 1, "only one task row should exist per (memo_id, tagger_id)")

	ts.Close()
}

func TestMemoTagTaskListFilters(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	if _, err := createTestingHostUser(ctx, ts); err != nil {
		t.Fatal(err)
	}

	for i := int32(1); i <= 3; i++ {
		_, err := ts.UpsertMemoTagTask(ctx, &store.CreateMemoTagTask{
			MemoID:   i,
			TaggerID: "t1",
			DueAt:    int64(i * 10),
		})
		require.NoError(t, err)
	}
	// Different tagger for memo 2.
	_, err := ts.UpsertMemoTagTask(ctx, &store.CreateMemoTagTask{
		MemoID:   2,
		TaggerID: "t2",
		DueAt:    25,
	})
	require.NoError(t, err)

	// Filter by memo id.
	byMemo, err := ts.ListMemoTagTasks(ctx, &store.FindMemoTagTask{MemoID: func() *int32 { v := int32(2); return &v }()})
	require.NoError(t, err)
	require.Len(t, byMemo, 2, "memo 2 should have two taggers")

	// Filter by status.
	byStatus, err := ts.ListMemoTagTasks(ctx, &store.FindMemoTagTask{
		StatusList: []store.MemoTagTaskStatus{store.MemoTagTaskPending},
	})
	require.NoError(t, err)
	require.Len(t, byStatus, 4, "all four tasks created are PENDING")

	// Filter by due before.
	dueBefore := int64(30)
	byDue, err := ts.ListMemoTagTasks(ctx, &store.FindMemoTagTask{DueBefore: &dueBefore})
	require.NoError(t, err)
	require.Len(t, byDue, 4, "all tasks have due_at <= 30 (10, 20, 30, 25)")

	// Limit.
	limit := 2
	limited, err := ts.ListMemoTagTasks(ctx, &store.FindMemoTagTask{Limit: &limit})
	require.NoError(t, err)
	require.Len(t, limited, 2)

	ts.Close()
}

func TestMemoTagTaskUpdateStatus(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	if _, err := createTestingHostUser(ctx, ts); err != nil {
		t.Fatal(err)
	}

	task, err := ts.UpsertMemoTagTask(ctx, &store.CreateMemoTagTask{
		MemoID:   7,
		TaggerID: "t1",
		DueAt:    500,
	})
	require.NoError(t, err)

	done := store.MemoTagTaskDone
	require.NoError(t, ts.UpdateMemoTagTask(ctx, &store.UpdateMemoTagTask{
		ID:     task.ID,
		Status: &done,
	}))

	got, err := ts.ListMemoTagTasks(ctx, &store.FindMemoTagTask{
		ID:         func() *int32 { v := task.ID; return &v }(),
		StatusList: []store.MemoTagTaskStatus{store.MemoTagTaskDone},
	})
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.Equal(t, store.MemoTagTaskDone, got[0].Status)

	// Pending filter should now exclude it.
	pending, err := ts.ListMemoTagTasks(ctx, &store.FindMemoTagTask{
		StatusList: []store.MemoTagTaskStatus{store.MemoTagTaskPending},
	})
	require.NoError(t, err)
	require.Len(t, pending, 0)

	ts.Close()
}
