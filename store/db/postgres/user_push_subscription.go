package postgres

import (
	"context"
	"database/sql"
	"strings"

	"github.com/pkg/errors"
	"github.com/usememos/memos/store"
)

func (d *DB) UpsertUserPushSubscription(ctx context.Context, upsert *store.UserPushSubscription) (*store.UserPushSubscription, error) {
	stmt := `
		INSERT INTO user_push_subscription (
			user_id, endpoint, p256dh, auth, user_agent, last_seen_ts
		)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (endpoint) DO UPDATE
		SET
			user_id = EXCLUDED.user_id,
			p256dh = EXCLUDED.p256dh,
			auth = EXCLUDED.auth,
			user_agent = EXCLUDED.user_agent,
			last_seen_ts = EXCLUDED.last_seen_ts,
			disabled_ts = NULL,
			updated_ts = EXTRACT(EPOCH FROM NOW())
		RETURNING
			id, user_id, endpoint, p256dh, auth, user_agent, last_seen_ts, disabled_ts, created_ts, updated_ts
	`
	subscription := &store.UserPushSubscription{}
	var disabledTs sql.NullInt64
	if err := d.db.QueryRowContext(ctx, stmt, upsert.UserID, upsert.Endpoint, upsert.P256Dh, upsert.Auth, upsert.UserAgent, upsert.LastSeenTs).Scan(
		&subscription.ID,
		&subscription.UserID,
		&subscription.Endpoint,
		&subscription.P256Dh,
		&subscription.Auth,
		&subscription.UserAgent,
		&subscription.LastSeenTs,
		&disabledTs,
		&subscription.CreatedTs,
		&subscription.UpdatedTs,
	); err != nil {
		return nil, err
	}
	if disabledTs.Valid {
		subscription.DisabledTs = &disabledTs.Int64
	}
	return subscription, nil
}

func (d *DB) ListUserPushSubscriptions(ctx context.Context, find *store.FindUserPushSubscription) ([]*store.UserPushSubscription, error) {
	where, args := []string{"1 = 1"}, []any{}
	appendCondition := func(condition string, value any) {
		args = append(args, value)
		where = append(where, condition+" "+placeholder(len(args)))
	}
	if find.ID != nil {
		appendCondition("id =", *find.ID)
	}
	if find.UserID != nil {
		appendCondition("user_id =", *find.UserID)
	}
	if find.Endpoint != nil {
		appendCondition("endpoint =", *find.Endpoint)
	}
	if find.ActiveOnly {
		where = append(where, "disabled_ts IS NULL")
	}
	query := `
		SELECT
			id, user_id, endpoint, p256dh, auth, user_agent, last_seen_ts, disabled_ts, created_ts, updated_ts
		FROM user_push_subscription
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY updated_ts DESC, id DESC
	`
	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.UserPushSubscription{}
	for rows.Next() {
		subscription := &store.UserPushSubscription{}
		var disabledTs sql.NullInt64
		if err := rows.Scan(
			&subscription.ID,
			&subscription.UserID,
			&subscription.Endpoint,
			&subscription.P256Dh,
			&subscription.Auth,
			&subscription.UserAgent,
			&subscription.LastSeenTs,
			&disabledTs,
			&subscription.CreatedTs,
			&subscription.UpdatedTs,
		); err != nil {
			return nil, err
		}
		if disabledTs.Valid {
			subscription.DisabledTs = &disabledTs.Int64
		}
		list = append(list, subscription)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) DeleteUserPushSubscription(ctx context.Context, delete *store.DeleteUserPushSubscription) error {
	where, args := []string{}, []any{}
	appendCondition := func(condition string, value any) {
		args = append(args, value)
		where = append(where, condition+" "+placeholder(len(args)))
	}
	if delete.ID != nil {
		appendCondition("id =", *delete.ID)
	}
	if delete.UserID != nil {
		appendCondition("user_id =", *delete.UserID)
	}
	if delete.Endpoint != nil {
		appendCondition("endpoint =", *delete.Endpoint)
	}
	if len(where) == 0 {
		return errors.New("no fields to delete in DeleteUserPushSubscription")
	}
	_, err := d.db.ExecContext(ctx, "DELETE FROM user_push_subscription WHERE "+strings.Join(where, " AND "), args...)
	return err
}

func (d *DB) DisableUserPushSubscription(ctx context.Context, update *store.DisableUserPushSubscription) error {
	if update.ID == nil {
		return errors.New("id is required")
	}
	_, err := d.db.ExecContext(ctx, "UPDATE user_push_subscription SET disabled_ts = EXTRACT(EPOCH FROM NOW()), updated_ts = EXTRACT(EPOCH FROM NOW()) WHERE id = $1", *update.ID)
	return err
}

func (d *DB) CreateMemoScheduleReminderDelivery(ctx context.Context, create *store.MemoScheduleReminderDelivery) (*store.MemoScheduleReminderDelivery, bool, error) {
	stmt := `
		INSERT INTO memo_schedule_reminder_delivery (
			user_id, memo_id, occurrence_time, reminder_offset_seconds, subscription_id
		)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, memo_id, occurrence_time, reminder_offset_seconds, subscription_id) DO NOTHING
		RETURNING id, user_id, memo_id, occurrence_time, reminder_offset_seconds, subscription_id, created_ts
	`
	delivery := &store.MemoScheduleReminderDelivery{}
	err := d.db.QueryRowContext(ctx, stmt, create.UserID, create.MemoID, create.OccurrenceTime, create.ReminderOffsetSeconds, create.SubscriptionID).Scan(
		&delivery.ID,
		&delivery.UserID,
		&delivery.MemoID,
		&delivery.OccurrenceTime,
		&delivery.ReminderOffsetSeconds,
		&delivery.SubscriptionID,
		&delivery.CreatedTs,
	)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return delivery, true, nil
}

func (d *DB) CreateMemoScheduleReminderInboxDelivery(ctx context.Context, create *store.MemoScheduleReminderInboxDelivery) (*store.MemoScheduleReminderInboxDelivery, bool, error) {
	stmt := `
		INSERT INTO memo_schedule_reminder_inbox_delivery (
			user_id, memo_id, occurrence_time, reminder_offset_seconds
		)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, memo_id, occurrence_time, reminder_offset_seconds) DO NOTHING
		RETURNING id, user_id, memo_id, occurrence_time, reminder_offset_seconds, created_ts
	`
	delivery := &store.MemoScheduleReminderInboxDelivery{}
	err := d.db.QueryRowContext(ctx, stmt, create.UserID, create.MemoID, create.OccurrenceTime, create.ReminderOffsetSeconds).Scan(
		&delivery.ID,
		&delivery.UserID,
		&delivery.MemoID,
		&delivery.OccurrenceTime,
		&delivery.ReminderOffsetSeconds,
		&delivery.CreatedTs,
	)
	if err == sql.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return delivery, true, nil
}
