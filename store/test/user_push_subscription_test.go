package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestUserPushSubscriptionStore(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	subscription, err := ts.UpsertUserPushSubscription(ctx, &store.UserPushSubscription{
		UserID:    user.ID,
		Endpoint:  "https://push.example.test/subscription-1",
		P256Dh:    "p256dh-key",
		Auth:      "auth-secret",
		UserAgent: "unit-test",
	})
	require.NoError(t, err)
	require.NotZero(t, subscription.ID)
	require.Equal(t, user.ID, subscription.UserID)
	require.Nil(t, subscription.DisabledTs)

	refreshed, err := ts.UpsertUserPushSubscription(ctx, &store.UserPushSubscription{
		UserID:    user.ID,
		Endpoint:  subscription.Endpoint,
		P256Dh:    "new-p256dh-key",
		Auth:      "new-auth-secret",
		UserAgent: "unit-test-2",
	})
	require.NoError(t, err)
	require.Equal(t, subscription.ID, refreshed.ID)
	require.Equal(t, "new-p256dh-key", refreshed.P256Dh)
	require.Equal(t, "new-auth-secret", refreshed.Auth)
	require.Equal(t, "unit-test-2", refreshed.UserAgent)
	require.Nil(t, refreshed.DisabledTs)

	activeOnly := true
	active, err := ts.ListUserPushSubscriptions(ctx, &store.FindUserPushSubscription{UserID: &user.ID, ActiveOnly: activeOnly})
	require.NoError(t, err)
	require.Len(t, active, 1)

	require.NoError(t, ts.DisableUserPushSubscription(ctx, &store.DisableUserPushSubscription{ID: &subscription.ID}))
	active, err = ts.ListUserPushSubscriptions(ctx, &store.FindUserPushSubscription{UserID: &user.ID, ActiveOnly: activeOnly})
	require.NoError(t, err)
	require.Empty(t, active)

	all, err := ts.ListUserPushSubscriptions(ctx, &store.FindUserPushSubscription{UserID: &user.ID})
	require.NoError(t, err)
	require.Len(t, all, 1)
	require.NotNil(t, all[0].DisabledTs)

	require.NoError(t, ts.DeleteUserPushSubscription(ctx, &store.DeleteUserPushSubscription{ID: &subscription.ID, UserID: &user.ID}))
	all, err = ts.ListUserPushSubscriptions(ctx, &store.FindUserPushSubscription{UserID: &user.ID})
	require.NoError(t, err)
	require.Empty(t, all)

	ts.Close()
}

func TestMemoScheduleReminderDeliveryClaim(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	subscription, err := ts.UpsertUserPushSubscription(ctx, &store.UserPushSubscription{
		UserID:    user.ID,
		Endpoint:  "https://push.example.test/subscription-2",
		P256Dh:    "p256dh-key",
		Auth:      "auth-secret",
		UserAgent: "unit-test",
	})
	require.NoError(t, err)

	memo, err := ts.CreateMemo(ctx, &store.Memo{
		UID:        "reminder-delivery",
		CreatorID:  user.ID,
		Content:    "Reminder delivery",
		Visibility: store.Private,
	})
	require.NoError(t, err)

	delivery, claimed, err := ts.CreateMemoScheduleReminderDelivery(ctx, &store.MemoScheduleReminderDelivery{
		UserID:                user.ID,
		MemoID:                memo.ID,
		OccurrenceTime:        1800000000,
		ReminderOffsetSeconds: 0,
		SubscriptionID:        subscription.ID,
	})
	require.NoError(t, err)
	require.True(t, claimed)
	require.NotZero(t, delivery.ID)

	_, claimed, err = ts.CreateMemoScheduleReminderDelivery(ctx, &store.MemoScheduleReminderDelivery{
		UserID:                user.ID,
		MemoID:                memo.ID,
		OccurrenceTime:        1800000000,
		ReminderOffsetSeconds: 0,
		SubscriptionID:        subscription.ID,
	})
	require.NoError(t, err)
	require.False(t, claimed)

	ts.Close()
}

func TestMemoScheduleReminderInboxDeliveryClaim(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	ts := NewTestingStore(ctx, t)
	user, err := createTestingHostUser(ctx, ts)
	require.NoError(t, err)

	memo, err := ts.CreateMemo(ctx, &store.Memo{
		UID:        "reminder-inbox-delivery",
		CreatorID:  user.ID,
		Content:    "Reminder inbox delivery",
		Visibility: store.Private,
	})
	require.NoError(t, err)

	delivery, claimed, err := ts.CreateMemoScheduleReminderInboxDelivery(ctx, &store.MemoScheduleReminderInboxDelivery{
		UserID:                user.ID,
		MemoID:                memo.ID,
		OccurrenceTime:        1800000000,
		ReminderOffsetSeconds: 0,
	})
	require.NoError(t, err)
	require.True(t, claimed)
	require.NotZero(t, delivery.ID)

	_, claimed, err = ts.CreateMemoScheduleReminderInboxDelivery(ctx, &store.MemoScheduleReminderInboxDelivery{
		UserID:                user.ID,
		MemoID:                memo.ID,
		OccurrenceTime:        1800000000,
		ReminderOffsetSeconds: 0,
	})
	require.NoError(t, err)
	require.False(t, claimed)

	_, claimed, err = ts.CreateMemoScheduleReminderInboxDelivery(ctx, &store.MemoScheduleReminderInboxDelivery{
		UserID:                user.ID,
		MemoID:                memo.ID,
		OccurrenceTime:        1800000000,
		ReminderOffsetSeconds: 3600,
	})
	require.NoError(t, err)
	require.True(t, claimed)

	ts.Close()
}
