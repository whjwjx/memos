package store

import (
	"context"
	"time"
)

// UserPushSubscription stores one browser/device Web Push subscription for a user.
type UserPushSubscription struct {
	ID int32

	// Standard fields
	CreatedTs  int64
	UpdatedTs  int64
	LastSeenTs int64
	DisabledTs *int64

	// Domain specific fields
	UserID    int32
	Endpoint  string
	P256Dh    string
	Auth      string
	UserAgent string
}

// FindUserPushSubscription filters push subscriptions.
type FindUserPushSubscription struct {
	ID         *int32
	UserID     *int32
	Endpoint   *string
	ActiveOnly bool
}

// DeleteUserPushSubscription deletes a push subscription.
type DeleteUserPushSubscription struct {
	ID       *int32
	UserID   *int32
	Endpoint *string
}

// DisableUserPushSubscription marks a push subscription inactive after delivery failures.
type DisableUserPushSubscription struct {
	ID *int32
}

// MemoScheduleReminderDelivery records that one reminder has been claimed for delivery.
type MemoScheduleReminderDelivery struct {
	ID int32

	// Standard fields
	CreatedTs int64

	// Domain specific fields
	UserID                int32
	MemoID                int32
	OccurrenceTime        int64
	ReminderOffsetSeconds int32
	SubscriptionID        int32
}

// MemoScheduleReminderInboxDelivery records that one reminder has been written to inbox.
type MemoScheduleReminderInboxDelivery struct {
	ID int32

	// Standard fields
	CreatedTs int64

	// Domain specific fields
	UserID                int32
	MemoID                int32
	OccurrenceTime        int64
	ReminderOffsetSeconds int32
}

// UpsertUserPushSubscription creates or refreshes a push subscription.
func (s *Store) UpsertUserPushSubscription(ctx context.Context, upsert *UserPushSubscription) (*UserPushSubscription, error) {
	if upsert.LastSeenTs == 0 {
		upsert.LastSeenTs = time.Now().Unix()
	}
	return s.driver.UpsertUserPushSubscription(ctx, upsert)
}

// ListUserPushSubscriptions returns push subscriptions matching the filter.
func (s *Store) ListUserPushSubscriptions(ctx context.Context, find *FindUserPushSubscription) ([]*UserPushSubscription, error) {
	return s.driver.ListUserPushSubscriptions(ctx, find)
}

// DeleteUserPushSubscription deletes a push subscription.
func (s *Store) DeleteUserPushSubscription(ctx context.Context, delete *DeleteUserPushSubscription) error {
	return s.driver.DeleteUserPushSubscription(ctx, delete)
}

// DisableUserPushSubscription marks a push subscription inactive.
func (s *Store) DisableUserPushSubscription(ctx context.Context, update *DisableUserPushSubscription) error {
	return s.driver.DisableUserPushSubscription(ctx, update)
}

// CreateMemoScheduleReminderDelivery claims one reminder delivery.
func (s *Store) CreateMemoScheduleReminderDelivery(ctx context.Context, create *MemoScheduleReminderDelivery) (*MemoScheduleReminderDelivery, bool, error) {
	return s.driver.CreateMemoScheduleReminderDelivery(ctx, create)
}

// CreateMemoScheduleReminderInboxDelivery claims one inbox reminder delivery.
func (s *Store) CreateMemoScheduleReminderInboxDelivery(ctx context.Context, create *MemoScheduleReminderInboxDelivery) (*MemoScheduleReminderInboxDelivery, bool, error) {
	return s.driver.CreateMemoScheduleReminderInboxDelivery(ctx, create)
}
