package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
)

func TestListMemoScheduleOccurrencesReturnsVisibleScheduledMemos(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "schedule-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	peer, err := ts.CreateRegularUser(ctx, "schedule-peer")
	require.NoError(t, err)
	peerCtx := ts.CreateUserContext(ctx, peer.ID)

	scheduledAt := time.Date(2026, 8, 28, 8, 0, 0, 0, time.UTC)
	ownMemo, err := ts.Service.CreateMemo(ownerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Content:       "private breakfast",
			Visibility:    apiv1.Visibility_PRIVATE,
			ScheduledTime: timestamppb.New(scheduledAt),
		},
	})
	require.NoError(t, err)

	publicMemo, err := ts.Service.CreateMemo(peerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Content:       "public breakfast",
			Visibility:    apiv1.Visibility_PUBLIC,
			ScheduledTime: timestamppb.New(scheduledAt.Add(time.Hour)),
		},
	})
	require.NoError(t, err)

	privatePeerMemo, err := ts.Service.CreateMemo(peerCtx, &apiv1.CreateMemoRequest{
		Memo: &apiv1.Memo{
			Content:       "hidden breakfast",
			Visibility:    apiv1.Visibility_PRIVATE,
			ScheduledTime: timestamppb.New(scheduledAt.Add(2 * time.Hour)),
		},
	})
	require.NoError(t, err)

	response, err := ts.Service.ListMemoScheduleOccurrences(ownerCtx, &apiv1.ListMemoScheduleOccurrencesRequest{
		StartTime: timestamppb.New(scheduledAt.Add(-time.Hour)),
		EndTime:   timestamppb.New(scheduledAt.Add(3 * time.Hour)),
	})
	require.NoError(t, err)
	require.Len(t, response.Occurrences, 2)

	memosByName := map[string]*apiv1.MemoScheduleOccurrence{}
	for _, occurrence := range response.Occurrences {
		memosByName[occurrence.Memo] = occurrence
	}
	require.Contains(t, memosByName, ownMemo.Name)
	require.Contains(t, memosByName, publicMemo.Name)
	require.NotContains(t, memosByName, privatePeerMemo.Name)
	require.Equal(t, scheduledAt.Unix(), memosByName[ownMemo.Name].OccurrenceTime.AsTime().Unix())
	require.Equal(t, scheduledAt.Add(time.Hour).Unix(), memosByName[publicMemo.Name].OccurrenceTime.AsTime().Unix())
}
