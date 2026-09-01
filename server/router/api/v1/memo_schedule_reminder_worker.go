package v1

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/pkg/errors"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/notification"
	"github.com/usememos/memos/store"
)

const (
	scheduleReminderLookback = 5 * time.Minute
	scheduleReminderOffset   = int32(0)
	scheduleReminderTitle    = "Memos reminder"
)

func (s *APIV1Service) processDueScheduleReminders(ctx context.Context) {
	subscriptionsByUserID := map[int32][]*store.UserPushSubscription{}
	var setting *storepb.InstanceNotificationSetting_WebPushSetting
	if s.NotificationWebPushSender != nil {
		subscriptions, err := s.Store.ListUserPushSubscriptions(ctx, &store.FindUserPushSubscription{ActiveOnly: true})
		if err != nil {
			slog.Warn("Failed to list push subscriptions for schedule reminders", slog.Any("err", err))
		} else if len(subscriptions) > 0 {
			setting, err = s.getOrCreateWebPushSetting(ctx)
			if err != nil {
				slog.Warn("Failed to load Web Push setting for schedule reminders", slog.Any("err", err))
			} else if setting.GetEnabled() {
				for _, subscription := range subscriptions {
					subscriptionsByUserID[subscription.UserID] = append(subscriptionsByUserID[subscription.UserID], subscription)
				}
			}
		}
	}

	normal := store.Normal
	hasSchedule := true
	memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		RowStatus:        &normal,
		HasScheduledTime: &hasSchedule,
		ExcludeComments:  true,
	})
	if err != nil {
		slog.Warn("Failed to list scheduled memos for reminders", slog.Any("err", err))
		return
	}
	if len(memos) == 0 {
		return
	}

	now := time.Now()
	start := now.Add(-scheduleReminderLookback)
	end := now.Add(time.Second)
	doneByMemoOccurrence, err := s.listDoneScheduleOccurrences(ctx, memos, start, end)
	if err != nil {
		slog.Warn("Failed to list completed schedule occurrences for reminders", slog.Any("err", err))
		return
	}
	for _, memo := range memos {
		userSubscriptions := subscriptionsByUserID[memo.CreatorID]
		for _, occurrenceTime := range expandMemoScheduleOccurrences(memo, start, end) {
			if _, ok := doneByMemoOccurrence[scheduleOccurrenceKey(memo.ID, occurrenceTime)]; ok {
				continue
			}
			s.createScheduleReminderInboxNotification(ctx, memo, occurrenceTime)
			for _, subscription := range userSubscriptions {
				s.sendScheduleReminder(ctx, memo, occurrenceTime, subscription, setting)
			}
		}
	}
}

func (s *APIV1Service) listDoneScheduleOccurrences(ctx context.Context, memos []*store.Memo, start, end time.Time) (map[string]struct{}, error) {
	memoIDs := make([]int32, 0, len(memos))
	for _, memo := range memos {
		memoIDs = append(memoIDs, memo.ID)
	}
	if len(memoIDs) == 0 {
		return map[string]struct{}{}, nil
	}
	startUnix := start.Unix()
	endUnix := end.Unix()
	rows, err := s.Store.ListMemoScheduleOccurrences(ctx, &store.FindMemoScheduleOccurrence{
		MemoIDList: memoIDs,
		TimeAfter:  &startUnix,
		TimeBefore: &endUnix,
		StatusList: []store.MemoScheduleOccurrenceStatus{store.MemoScheduleOccurrenceDone},
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list schedule occurrences")
	}
	done := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		done[scheduleOccurrenceKey(row.MemoID, row.OccurrenceTime)] = struct{}{}
	}
	return done, nil
}

func (s *APIV1Service) createScheduleReminderInboxNotification(ctx context.Context, memo *store.Memo, occurrenceTime int64) {
	if _, claimed, err := s.Store.CreateMemoScheduleReminderInboxDelivery(ctx, &store.MemoScheduleReminderInboxDelivery{
		UserID:                memo.CreatorID,
		MemoID:                memo.ID,
		OccurrenceTime:        occurrenceTime,
		ReminderOffsetSeconds: scheduleReminderOffset,
	}); err != nil {
		slog.Warn("Failed to claim schedule reminder inbox delivery",
			slog.Int("memo_id", int(memo.ID)),
			slog.Any("err", err))
		return
	} else if !claimed {
		return
	}

	if _, err := s.Store.CreateInbox(ctx, &store.Inbox{
		SenderID:   memo.CreatorID,
		ReceiverID: memo.CreatorID,
		Status:     store.UNREAD,
		Message: &storepb.InboxMessage{
			Type: storepb.InboxMessage_SCHEDULE_REMINDER,
			Payload: &storepb.InboxMessage_ScheduleReminder{
				ScheduleReminder: &storepb.InboxMessage_ScheduleReminderPayload{
					MemoId:                memo.ID,
					OccurrenceTime:        occurrenceTime,
					ReminderOffsetSeconds: scheduleReminderOffset,
				},
			},
		},
	}); err != nil {
		slog.Warn("Failed to create schedule reminder inbox notification",
			slog.Int("memo_id", int(memo.ID)),
			slog.Any("err", err))
	}
}

func (s *APIV1Service) sendScheduleReminder(ctx context.Context, memo *store.Memo, occurrenceTime int64, subscription *store.UserPushSubscription, setting *storepb.InstanceNotificationSetting_WebPushSetting) {
	if setting == nil || !setting.GetEnabled() {
		return
	}
	if _, claimed, err := s.Store.CreateMemoScheduleReminderDelivery(ctx, &store.MemoScheduleReminderDelivery{
		UserID:                memo.CreatorID,
		MemoID:                memo.ID,
		OccurrenceTime:        occurrenceTime,
		ReminderOffsetSeconds: scheduleReminderOffset,
		SubscriptionID:        subscription.ID,
	}); err != nil {
		slog.Warn("Failed to claim schedule reminder delivery",
			slog.Int("memo_id", int(memo.ID)),
			slog.Int("subscription_id", int(subscription.ID)),
			slog.Any("err", err))
		return
	} else if !claimed {
		return
	}

	body, err := s.memoNotificationSnippet(memo)
	if err != nil {
		slog.Warn("Failed to build schedule reminder snippet", slog.Int("memo_id", int(memo.ID)), slog.Any("err", err))
	}
	if body == "" {
		body = "A scheduled memo is due."
	}
	if err := s.NotificationWebPushSender.Send(ctx, subscription, &notification.WebPushPayload{
		Title: scheduleReminderTitle,
		Body:  body,
		URL:   fmt.Sprintf("/memos/%s", memo.UID),
		Tag:   fmt.Sprintf("memo-%d-%d", memo.ID, occurrenceTime),
	}, setting); err != nil {
		slog.Warn("Failed to send schedule reminder push notification",
			slog.Int("memo_id", int(memo.ID)),
			slog.Int("subscription_id", int(subscription.ID)),
			slog.Any("err", err))
		if notification.ShouldDisablePushSubscription(err) {
			s.disablePushSubscriptionAfterFailure(ctx, subscription)
		}
	}
}
