package mysql

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
		VALUES (?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			status = VALUES(status),
			completed_ts = VALUES(completed_ts),
			updated_ts = UNIX_TIMESTAMP()
	`
	if _, err := d.db.ExecContext(ctx, stmt, upsert.MemoID, upsert.OccurrenceTime, string(upsert.Status), upsert.CompletedTs); err != nil {
		return nil, err
	}
	timeBefore := upsert.OccurrenceTime + 1
	rows, err := d.ListMemoScheduleOccurrences(ctx, &store.FindMemoScheduleOccurrence{
		MemoID:     &upsert.MemoID,
		TimeAfter:  &upsert.OccurrenceTime,
		TimeBefore: &timeBefore,
	})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, errors.New("failed to upsert memo schedule occurrence")
	}
	return rows[0], nil
}

func (d *DB) ListMemoScheduleOccurrences(ctx context.Context, find *store.FindMemoScheduleOccurrence) ([]*store.MemoScheduleOccurrence, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *find.ID)
	}
	if find.MemoID != nil {
		where, args = append(where, "`memo_id` = ?"), append(args, *find.MemoID)
	}
	if len(find.MemoIDList) > 0 {
		placeholders := make([]string, 0, len(find.MemoIDList))
		for _, id := range find.MemoIDList {
			placeholders = append(placeholders, "?")
			args = append(args, id)
		}
		where = append(where, "`memo_id` IN ("+strings.Join(placeholders, ",")+")")
	}
	if find.TimeAfter != nil {
		where, args = append(where, "`occurrence_time` >= ?"), append(args, *find.TimeAfter)
	}
	if find.TimeBefore != nil {
		where, args = append(where, "`occurrence_time` < ?"), append(args, *find.TimeBefore)
	}
	if len(find.StatusList) > 0 {
		placeholders := strings.Repeat("?, ", len(find.StatusList))
		placeholders = strings.TrimSuffix(placeholders, ", ")
		where = append(where, fmt.Sprintf("`status` IN (%s)", placeholders))
		for _, status := range find.StatusList {
			args = append(args, string(status))
		}
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
	if delete.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *delete.ID)
	}
	if delete.MemoID != nil {
		where, args = append(where, "`memo_id` = ?"), append(args, *delete.MemoID)
	}
	if delete.OccurrenceTime != nil {
		where, args = append(where, "`occurrence_time` = ?"), append(args, *delete.OccurrenceTime)
	}
	if len(where) == 0 {
		return errors.New("no fields to delete in DeleteMemoScheduleOccurrence")
	}
	_, err := d.db.ExecContext(ctx, "DELETE FROM `memo_schedule_occurrence` WHERE "+strings.Join(where, " AND "), args...)
	return err
}
