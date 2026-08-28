package sqlite

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
		ON CONFLICT(memo_id, occurrence_time) DO UPDATE
		SET
			status = excluded.status,
			completed_ts = excluded.completed_ts,
			updated_ts = strftime('%s', 'now')
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
	if find.ID != nil {
		where, args = append(where, "id = ?"), append(args, *find.ID)
	}
	if find.MemoID != nil {
		where, args = append(where, "memo_id = ?"), append(args, *find.MemoID)
	}
	if len(find.MemoIDList) > 0 {
		placeholders := make([]string, 0, len(find.MemoIDList))
		for _, id := range find.MemoIDList {
			placeholders = append(placeholders, "?")
			args = append(args, id)
		}
		where = append(where, "memo_id IN ("+strings.Join(placeholders, ",")+")")
	}
	if find.TimeAfter != nil {
		where, args = append(where, "occurrence_time >= ?"), append(args, *find.TimeAfter)
	}
	if find.TimeBefore != nil {
		where, args = append(where, "occurrence_time < ?"), append(args, *find.TimeBefore)
	}
	if len(find.StatusList) > 0 {
		placeholders := strings.Repeat("?, ", len(find.StatusList))
		placeholders = strings.TrimSuffix(placeholders, ", ")
		where = append(where, fmt.Sprintf("status IN (%s)", placeholders))
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
		where, args = append(where, "id = ?"), append(args, *delete.ID)
	}
	if delete.MemoID != nil {
		where, args = append(where, "memo_id = ?"), append(args, *delete.MemoID)
	}
	if delete.OccurrenceTime != nil {
		where, args = append(where, "occurrence_time = ?"), append(args, *delete.OccurrenceTime)
	}
	if len(where) == 0 {
		return errors.New("no fields to delete in DeleteMemoScheduleOccurrence")
	}
	_, err := d.db.ExecContext(ctx, "DELETE FROM memo_schedule_occurrence WHERE "+strings.Join(where, " AND "), args...)
	return err
}
