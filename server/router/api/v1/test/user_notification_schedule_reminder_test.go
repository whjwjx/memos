package test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestListUserNotificationsIncludesScheduleReminder(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "schedule-notification-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	occurrenceTime := time.Now().Unix()
	memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "schedule-notification-memo",
		CreatorID:  user.ID,
		Content:    "buy something",
		Visibility: store.Private,
	})
	require.NoError(t, err)

	_, err = ts.Store.CreateInbox(ctx, &store.Inbox{
		SenderID:   user.ID,
		ReceiverID: user.ID,
		Status:     store.UNREAD,
		Message: &storepb.InboxMessage{
			Type: storepb.InboxMessage_SCHEDULE_REMINDER,
			Payload: &storepb.InboxMessage_ScheduleReminder{
				ScheduleReminder: &storepb.InboxMessage_ScheduleReminderPayload{
					MemoId:                memo.ID,
					OccurrenceTime:        occurrenceTime,
					ReminderOffsetSeconds: 0,
				},
			},
		},
	})
	require.NoError(t, err)

	response, err := ts.Service.ListUserNotifications(userCtx, &apiv1.ListUserNotificationsRequest{
		Parent: fmt.Sprintf("users/%s", user.Username),
	})
	require.NoError(t, err)
	require.Len(t, response.Notifications, 1)
	require.Equal(t, apiv1.UserNotification_SCHEDULE_REMINDER, response.Notifications[0].Type)

	payload := response.Notifications[0].GetScheduleReminder()
	require.NotNil(t, payload)
	require.Equal(t, fmt.Sprintf("memos/%s", memo.UID), payload.Memo)
	require.Equal(t, "buy something", payload.MemoSnippet)
	require.Equal(t, occurrenceTime, payload.OccurrenceTime.AsTime().Unix())
	require.Zero(t, payload.ReminderOffset.AsDuration())
}
