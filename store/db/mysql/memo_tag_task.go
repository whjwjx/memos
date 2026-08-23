package mysql

import (
	"context"
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"github.com/usememos/memos/store"
)

func (d *DB) UpsertMemoTagTask(ctx context.Context, create *store.CreateMemoTagTask) (*store.MemoTagTask, error) {
	stmt := `
		INSERT INTO ` + "`memo_tag_task`" + ` (
			` + "`memo_id`" + `, ` + "`tagger_id`" + `, ` + "`status`" + `, ` + "`due_at`" + `
		)
		VALUES (?, ?, 'PENDING', ?)
		ON DUPLICATE KEY UPDATE
			` + "`due_at`" + ` = VALUES(` + "`due_at`" + `),
			` + "`updated_ts`" + ` = UNIX_TIMESTAMP()
	`
	if _, err := d.db.ExecContext(ctx, stmt, create.MemoID, create.TaggerID, create.DueAt); err != nil {
		return nil, err
	}

	// ON DUPLICATE KEY UPDATE does not return rows, so fetch the canonical row.
	task := &store.MemoTagTask{}
	query := `
		SELECT ` + "`id`" + `, ` + "`memo_id`" + `, ` + "`tagger_id`" + `, ` + "`status`" + `, ` + "`due_at`" + `, ` + "`created_ts`" + `, ` + "`updated_ts`" + `
		FROM ` + "`memo_tag_task`" + `
		WHERE ` + "`memo_id`" + ` = ? AND ` + "`tagger_id`" + ` = ?
	`
	if err := d.db.QueryRowContext(ctx, query, create.MemoID, create.TaggerID).Scan(
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
		where, args = append(where, "`id` = ?"), append(args, *find.ID)
	}
	if find.MemoID != nil {
		where, args = append(where, "`memo_id` = ?"), append(args, *find.MemoID)
	}
	if len(find.StatusList) > 0 {
		placeholders := strings.Repeat("?, ", len(find.StatusList))
		placeholders = strings.TrimSuffix(placeholders, ", ")
		where = append(where, fmt.Sprintf("`status` IN (%s)", placeholders))
		for _, status := range find.StatusList {
			args = append(args, string(status))
		}
	}
	if find.DueBefore != nil {
		where, args = append(where, "`due_at` <= ?"), append(args, *find.DueBefore)
	}

	query := `
		SELECT ` + "`id`" + `, ` + "`memo_id`" + `, ` + "`tagger_id`" + `, ` + "`status`" + `, ` + "`due_at`" + `, ` + "`created_ts`" + `, ` + "`updated_ts`" + `
		FROM ` + "`memo_tag_task`" + `
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
		set, args = append(set, "`status` = ?"), append(args, string(*update.Status))
	}
	if update.DueAt != nil {
		set, args = append(set, "`due_at` = ?"), append(args, *update.DueAt)
	}
	if len(set) == 0 {
		return errors.New("no fields to update in UpdateMemoTagTask")
	}
	set = append(set, "`updated_ts` = UNIX_TIMESTAMP()")
	args = append(args, update.ID)

	stmt := "UPDATE `memo_tag_task` SET " + strings.Join(set, ", ") + " WHERE `id` = ?"
	_, err := d.db.ExecContext(ctx, stmt, args...)
	return err
}
