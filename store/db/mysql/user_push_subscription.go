package mysql

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
		VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			user_id = VALUES(user_id),
			p256dh = VALUES(p256dh),
			auth = VALUES(auth),
			user_agent = VALUES(user_agent),
			last_seen_ts = VALUES(last_seen_ts),
			disabled_ts = NULL,
			updated_ts = UNIX_TIMESTAMP()
	`
	if _, err := d.db.ExecContext(ctx, stmt, upsert.UserID, upsert.Endpoint, upsert.P256Dh, upsert.Auth, upsert.UserAgent, upsert.LastSeenTs); err != nil {
		return nil, err
	}
	rows, err := d.ListUserPushSubscriptions(ctx, &store.FindUserPushSubscription{Endpoint: &upsert.Endpoint})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, errors.New("failed to upsert user push subscription")
	}
	return rows[0], nil
}

func (d *DB) ListUserPushSubscriptions(ctx context.Context, find *store.FindUserPushSubscription) ([]*store.UserPushSubscription, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *find.ID)
	}
	if find.UserID != nil {
		where, args = append(where, "`user_id` = ?"), append(args, *find.UserID)
	}
	if find.Endpoint != nil {
		where, args = append(where, "`endpoint` = ?"), append(args, *find.Endpoint)
	}
	if find.ActiveOnly {
		where = append(where, "`disabled_ts` IS NULL")
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
	if delete.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *delete.ID)
	}
	if delete.UserID != nil {
		where, args = append(where, "`user_id` = ?"), append(args, *delete.UserID)
	}
	if delete.Endpoint != nil {
		where, args = append(where, "`endpoint` = ?"), append(args, *delete.Endpoint)
	}
	if len(where) == 0 {
		return errors.New("no fields to delete in DeleteUserPushSubscription")
	}
	_, err := d.db.ExecContext(ctx, "DELETE FROM `user_push_subscription` WHERE "+strings.Join(where, " AND "), args...)
	return err
}

func (d *DB) DisableUserPushSubscription(ctx context.Context, update *store.DisableUserPushSubscription) error {
	if update.ID == nil {
		return errors.New("id is required")
	}
	_, err := d.db.ExecContext(ctx, "UPDATE `user_push_subscription` SET `disabled_ts` = UNIX_TIMESTAMP(), `updated_ts` = UNIX_TIMESTAMP() WHERE `id` = ?", *update.ID)
	return err
}

func (d *DB) CreateMemoScheduleReminderDelivery(ctx context.Context, create *store.MemoScheduleReminderDelivery) (*store.MemoScheduleReminderDelivery, bool, error) {
	stmt := `
		INSERT IGNORE INTO memo_schedule_reminder_delivery (
			user_id, memo_id, occurrence_time, reminder_offset_seconds, subscription_id
		)
		VALUES (?, ?, ?, ?, ?)
	`
	result, err := d.db.ExecContext(ctx, stmt, create.UserID, create.MemoID, create.OccurrenceTime, create.ReminderOffsetSeconds, create.SubscriptionID)
	if err != nil {
		return nil, false, err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return nil, false, err
	}
	if rowsAffected == 0 {
		return nil, false, nil
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, false, err
	}
	delivery := &store.MemoScheduleReminderDelivery{}
	if err := d.db.QueryRowContext(ctx, `
		SELECT id, user_id, memo_id, occurrence_time, reminder_offset_seconds, subscription_id, created_ts
		FROM memo_schedule_reminder_delivery
		WHERE id = ?
	`, id).Scan(
		&delivery.ID,
		&delivery.UserID,
		&delivery.MemoID,
		&delivery.OccurrenceTime,
		&delivery.ReminderOffsetSeconds,
		&delivery.SubscriptionID,
		&delivery.CreatedTs,
	); err != nil {
		return nil, false, err
	}
	return delivery, true, nil
}

func (d *DB) CreateMemoScheduleReminderInboxDelivery(ctx context.Context, create *store.MemoScheduleReminderInboxDelivery) (*store.MemoScheduleReminderInboxDelivery, bool, error) {
	stmt := `
		INSERT IGNORE INTO memo_schedule_reminder_inbox_delivery (
			user_id, memo_id, occurrence_time, reminder_offset_seconds
		)
		VALUES (?, ?, ?, ?)
	`
	result, err := d.db.ExecContext(ctx, stmt, create.UserID, create.MemoID, create.OccurrenceTime, create.ReminderOffsetSeconds)
	if err != nil {
		return nil, false, err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return nil, false, err
	}
	if rowsAffected == 0 {
		return nil, false, nil
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, false, err
	}
	delivery := &store.MemoScheduleReminderInboxDelivery{}
	if err := d.db.QueryRowContext(ctx, `
		SELECT id, user_id, memo_id, occurrence_time, reminder_offset_seconds, created_ts
		FROM memo_schedule_reminder_inbox_delivery
		WHERE id = ?
	`, id).Scan(
		&delivery.ID,
		&delivery.UserID,
		&delivery.MemoID,
		&delivery.OccurrenceTime,
		&delivery.ReminderOffsetSeconds,
		&delivery.CreatedTs,
	); err != nil {
		return nil, false, err
	}
	return delivery, true, nil
}
