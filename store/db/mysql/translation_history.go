package mysql

import (
	"context"
	"fmt"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

func (d *DB) CreateTranslationHistory(ctx context.Context, create *store.TranslationHistory) (*store.TranslationHistory, error) {
	stmt := `
		INSERT INTO ` + "`translation_history`" + ` (
			uid, user_id, source_text, translated_text, source_language, target_language, provider_id, model
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`
	result, err := d.db.ExecContext(ctx, stmt,
		create.UID,
		create.UserID,
		create.SourceText,
		create.TranslatedText,
		create.SourceLanguage,
		create.TargetLanguage,
		create.ProviderID,
		create.Model,
	)
	if err != nil {
		return nil, err
	}
	rawID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	id := int32(rawID)
	history, err := d.GetTranslationHistory(ctx, &store.FindTranslationHistory{ID: &id})
	if err != nil {
		return nil, err
	}
	if history == nil {
		return nil, errors.New("failed to create translation history")
	}
	return history, nil
}

func (d *DB) ListTranslationHistories(ctx context.Context, find *store.FindTranslationHistory) ([]*store.TranslationHistory, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *find.ID)
	}
	if find.UID != nil {
		where, args = append(where, "`uid` = ?"), append(args, *find.UID)
	}
	if find.UserID != nil {
		where, args = append(where, "`user_id` = ?"), append(args, *find.UserID)
	}
	query := `
		SELECT
			id, uid, user_id, source_text, translated_text, source_language, target_language, provider_id, model, created_ts
		FROM ` + "`translation_history`" + `
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY created_ts DESC, id DESC
	`
	if find.Limit != nil {
		query += fmt.Sprintf(" LIMIT %d", *find.Limit)
	}
	if find.Offset != nil {
		query += fmt.Sprintf(" OFFSET %d", *find.Offset)
	}

	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	list := []*store.TranslationHistory{}
	for rows.Next() {
		history := &store.TranslationHistory{}
		if err := rows.Scan(
			&history.ID,
			&history.UID,
			&history.UserID,
			&history.SourceText,
			&history.TranslatedText,
			&history.SourceLanguage,
			&history.TargetLanguage,
			&history.ProviderID,
			&history.Model,
			&history.CreatedTs,
		); err != nil {
			return nil, err
		}
		list = append(list, history)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) GetTranslationHistory(ctx context.Context, find *store.FindTranslationHistory) (*store.TranslationHistory, error) {
	limit := 1
	find.Limit = &limit
	list, err := d.ListTranslationHistories(ctx, find)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	return list[0], nil
}

func (d *DB) DeleteTranslationHistory(ctx context.Context, delete *store.DeleteTranslationHistory) error {
	where, args := []string{"1 = 1"}, []any{}
	if delete.ID != nil {
		where, args = append(where, "`id` = ?"), append(args, *delete.ID)
	}
	if delete.UID != nil {
		where, args = append(where, "`uid` = ?"), append(args, *delete.UID)
	}
	if delete.UserID != nil {
		where, args = append(where, "`user_id` = ?"), append(args, *delete.UserID)
	}
	_, err := d.db.ExecContext(ctx, "DELETE FROM `translation_history` WHERE "+strings.Join(where, " AND "), args...)
	return err
}

func (d *DB) DeleteTranslationHistories(ctx context.Context, delete *store.DeleteTranslationHistories) error {
	where, args := []string{"1 = 1"}, []any{}
	if delete.UserID != nil {
		where, args = append(where, "`user_id` = ?"), append(args, *delete.UserID)
	}
	_, err := d.db.ExecContext(ctx, "DELETE FROM `translation_history` WHERE "+strings.Join(where, " AND "), args...)
	return err
}
