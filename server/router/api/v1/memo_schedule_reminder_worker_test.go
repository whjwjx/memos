package v1

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestProcessDueScheduleRemindersCreatesInboxWithoutPushSubscription(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)
	svc.NotificationWebPushSender = nil

	user, err := svc.Store.CreateUser(ctx, &store.User{
		Username: "schedule-reminder-user",
		Role:     store.RoleUser,
		Email:    "schedule-reminder-user@example.com",
	})
	require.NoError(t, err)

	scheduledTime := time.Now().Add(-time.Minute).Unix()
	memo, err := svc.Store.CreateMemo(ctx, &store.Memo{
		UID:           "schedule-reminder-memo",
		CreatorID:     user.ID,
		Content:       "buy something",
		Visibility:    store.Private,
		ScheduledTime: &scheduledTime,
	})
	require.NoError(t, err)

	svc.processDueScheduleReminders(ctx)
	svc.processDueScheduleReminders(ctx)

	inboxes, err := svc.Store.ListInboxes(ctx, &store.FindInbox{
		ReceiverID: &user.ID,
	})
	require.NoError(t, err)
	require.Len(t, inboxes, 1)
	require.Equal(t, store.UNREAD, inboxes[0].Status)
	require.Equal(t, storepb.InboxMessage_SCHEDULE_REMINDER, inboxes[0].Message.GetType())
	require.Equal(t, memo.ID, inboxes[0].Message.GetScheduleReminder().GetMemoId())
	require.Equal(t, scheduledTime, inboxes[0].Message.GetScheduleReminder().GetOccurrenceTime())
}
