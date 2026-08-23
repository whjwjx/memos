package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"github.com/usememos/memos/store"
)

func (d *DB) UpsertMemoTagTask(ctx context.Context, create *store.CreateMemoTagTask) (*store.MemoTagTask, error) {
	stmt := `
		INSERT INTO memo_tag_task (
			memo_id, tagger_id, status, due_at
		)
		VALUES ($1, $2, 'PENDING', $3)
		ON CONFLICT (memo_id, tagger_id) DO UPDATE
		SET
			due_at = EXCLUDED.due_at,
			status = CASE WHEN memo_tag_task.status = 'PENDING' THEN 'PENDING' ELSE memo_tag_task.status END,
			updated_ts = EXTRACT(EPOCH FROM NOW())
		RETURNING
			id, memo_id, tagger_id, status, due_at, created_ts, updated_ts
	`
	task := &store.MemoTagTask{}
	if err := d.db.QueryRowContext(ctx, stmt, create.MemoID, create.TaggerID, create.DueAt).Scan(
		&task.ID,
		&task.MemoID,
		&task.TaggerID,
		&task.Status,
		&task.DueAt,
		&task.CreatedTs,
		&task.UpdatedTs,
	); err != nil {
		return nil, err
	}
	return task, nil
}

func (d *DB) ListMemoTagTasks(ctx context.Context, find *store.FindMemoTagTask) ([]*store.MemoTagTask, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "id = "+placeholder(len(args)+1)), append(args, *find.ID)
	}
	if find.MemoID != nil {
		where, args = append(where, "memo_id = "+placeholder(len(args)+1)), append(args, *find.MemoID)
	}
	if len(find.StatusList) > 0 {
		placeholdersList := []string{}
		for _, status := range find.StatusList {
			args = append(args, string(status))
			placeholdersList = append(placeholdersList, placeholder(len(args)))
		}
		where = append(where, "status IN ("+strings.Join(placeholdersList, ", ")+")")
	}
	if find.DueBefore != nil {
		where, args = append(where, "due_at <= "+placeholder(len(args)+1)), append(args, *find.DueBefore)
	}

	query := `
		SELECT
			id, memo_id, tagger_id, status, due_at, created_ts, updated_ts
		FROM memo_tag_task
		WHERE ` + strings.Join(where, " AND ")
	if find.Limit != nil {
		query += fmt.Sprintf(" LIMIT %d", *find.Limit)
	}

	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.MemoTagTask{}
	for rows.Next() {
		task := &store.MemoTagTask{}
		if err := rows.Scan(
			&task.ID,
			&task.MemoID,
			&task.TaggerID,
			&task.Status,
			&task.DueAt,
			&task.CreatedTs,
			&task.UpdatedTs,
		); err != nil {
			return nil, err
		}
		list = append(list, task)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) UpdateMemoTagTask(ctx context.Context, update *store.UpdateMemoTagTask) error {
	set, args := []string{}, []any{}
	if update.Status != nil {
		args = append(args, string(*update.Status))
		set = append(set, "status = "+placeholder(len(args)))
	}
	if update.DueAt != nil {
		args = append(args, *update.DueAt)
		set = append(set, "due_at = "+placeholder(len(args)))
	}
	if len(set) == 0 {
		return errors.New("no fields to update in UpdateMemoTagTask")
	}
	args = append(args, update.ID)
	stmt := "UPDATE memo_tag_task SET " + strings.Join(set, ", ") + ", updated_ts = EXTRACT(EPOCH FROM NOW()) WHERE id = " + placeholder(len(args))
	_, err := d.db.ExecContext(ctx, stmt, args...)
	return err
}
