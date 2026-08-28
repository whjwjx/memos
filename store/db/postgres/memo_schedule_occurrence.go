package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"github.com/usememos/memos/store"
)

func (d *DB) UpsertMemoScheduleOccurrence(ctx context.Context, upsert *store.MemoScheduleOccurrence) (*store.MemoScheduleOccurrence, error) {
	stmt := `
		INSERT INTO memo_schedule_occurrence (
			memo_id, occurrence_time, status, completed_ts
		)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (memo_id, occurrence_time) DO UPDATE
		SET
			status = EXCLUDED.status,
			completed_ts = EXCLUDED.completed_ts,
			updated_ts = EXTRACT(EPOCH FROM NOW())
		RETURNING
			id, memo_id, occurrence_time, status, completed_ts, created_ts, updated_ts
	`
	occurrence := &store.MemoScheduleOccurrence{}
	if err := d.db.QueryRowContext(ctx, stmt, upsert.MemoID, upsert.OccurrenceTime, string(upsert.Status), upsert.CompletedTs).Scan(
		&occurrence.ID,
		&occurrence.MemoID,
		&occurrence.OccurrenceTime,
		&occurrence.Status,
		&occurrence.CompletedTs,
		&occurrence.CreatedTs,
		&occurrence.UpdatedTs,
	); err != nil {
		return nil, err
	}
	return occurrence, nil
}

func (d *DB) ListMemoScheduleOccurrences(ctx context.Context, find *store.FindMemoScheduleOccurrence) ([]*store.MemoScheduleOccurrence, error) {
	where, args := []string{"1 = 1"}, []any{}
	appendCondition := func(condition string, value any) {
		args = append(args, value)
		where = append(where, condition+" "+placeholder(len(args)))
	}
	if find.ID != nil {
		appendCondition("id =", *find.ID)
	}
	if find.MemoID != nil {
		appendCondition("memo_id =", *find.MemoID)
	}
	if len(find.MemoIDList) > 0 {
		holders := make([]string, 0, len(find.MemoIDList))
		for _, id := range find.MemoIDList {
			args = append(args, id)
			holders = append(holders, placeholder(len(args)))
		}
		where = append(where, "memo_id IN ("+strings.Join(holders, ", ")+")")
	}
	if find.TimeAfter != nil {
		appendCondition("occurrence_time >=", *find.TimeAfter)
	}
	if find.TimeBefore != nil {
		appendCondition("occurrence_time <", *find.TimeBefore)
	}
	if len(find.StatusList) > 0 {
		holders := make([]string, 0, len(find.StatusList))
		for _, status := range find.StatusList {
			args = append(args, string(status))
			holders = append(holders, placeholder(len(args)))
		}
		where = append(where, fmt.Sprintf("status IN (%s)", strings.Join(holders, ", ")))
	}

	query := `
		SELECT
			id, memo_id, occurrence_time, status, completed_ts, created_ts, updated_ts
		FROM memo_schedule_occurrence
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY occurrence_time ASC, id ASC
	`
	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.MemoScheduleOccurrence{}
	for rows.Next() {
		occurrence := &store.MemoScheduleOccurrence{}
		if err := rows.Scan(
			&occurrence.ID,
			&occurrence.MemoID,
			&occurrence.OccurrenceTime,
			&occurrence.Status,
			&occurrence.CompletedTs,
			&occurrence.CreatedTs,
			&occurrence.UpdatedTs,
		); err != nil {
			return nil, err
		}
		list = append(list, occurrence)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) DeleteMemoScheduleOccurrence(ctx context.Context, delete *store.DeleteMemoScheduleOccurrence) error {
	where, args := []string{}, []any{}
	appendCondition := func(condition string, value any) {
		args = append(args, value)
		where = append(where, condition+" "+placeholder(len(args)))
	}
	if delete.ID != nil {
		appendCondition("id =", *delete.ID)
	}
	if delete.MemoID != nil {
		appendCondition("memo_id =", *delete.MemoID)
	}
	if delete.OccurrenceTime != nil {
		appendCondition("occurrence_time =", *delete.OccurrenceTime)
	}
	if len(where) == 0 {
		return errors.New("no fields to delete in DeleteMemoScheduleOccurrence")
	}
	_, err := d.db.ExecContext(ctx, "DELETE FROM memo_schedule_occurrence WHERE "+strings.Join(where, " AND "), args...)
	return err
}
