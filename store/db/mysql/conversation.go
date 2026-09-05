package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

func (d *DB) CreateConversation(ctx context.Context, create *store.CreateConversation) (*store.Conversation, error) {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	stmt := `
		INSERT INTO ` + "`conversation`" + ` (
			uid, user_id, title, agent_id, llm_id
		)
		VALUES (?, ?, ?, ?, ?)
	`
	result, err := tx.ExecContext(ctx, stmt, create.UID, create.UserID, create.Title, create.AgentID, create.LLMID)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	conv, err := d.findConversationImpl(ctx, tx, "id = ?", id)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return conv, nil
}

func (*DB) findConversationImpl(ctx context.Context, tx *sql.Tx, where string, args ...any) (*store.Conversation, error) {
	query := `
		SELECT
			id, uid, user_id, title, agent_id, llm_id, created_ts, updated_ts
		FROM ` + "`conversation`" + `
		WHERE ` + where + `
		LIMIT 1
	`
	conv := &store.Conversation{}
	if err := tx.QueryRowContext(ctx, query, args...).Scan(
		&conv.ID, &conv.UID, &conv.UserID, &conv.Title, &conv.AgentID, &conv.LLMID, &conv.CreatedTs, &conv.UpdatedTs,
	); err != nil {
		return nil, err
	}
	return conv, nil
}

func (d *DB) ListConversations(ctx context.Context, find *store.FindConversation) ([]*store.Conversation, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "id = ?"), append(args, *find.ID)
	}
	if find.UID != nil {
		where, args = append(where, "uid = ?"), append(args, *find.UID)
	}
	if find.UserID != nil {
		where, args = append(where, "user_id = ?"), append(args, *find.UserID)
	}
	query := `
		SELECT
			id, uid, user_id, title, agent_id, llm_id, created_ts, updated_ts
		FROM ` + "`conversation`" + `
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY updated_ts DESC
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

	list := []*store.Conversation{}
	for rows.Next() {
		conv := &store.Conversation{}
		if err := rows.Scan(
			&conv.ID, &conv.UID, &conv.UserID, &conv.Title, &conv.AgentID, &conv.LLMID, &conv.CreatedTs, &conv.UpdatedTs,
		); err != nil {
			return nil, err
		}
		list = append(list, conv)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) UpdateConversation(ctx context.Context, update *store.UpdateConversation) (*store.Conversation, error) {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	set, args := []string{}, []any{}
	if update.Title != nil {
		set, args = append(set, "title = ?"), append(args, *update.Title)
	}
	if update.AgentID != nil {
		set, args = append(set, "agent_id = ?"), append(args, *update.AgentID)
	}
	if update.LLMID != nil {
		set, args = append(set, "llm_id = ?"), append(args, *update.LLMID)
	}
	if len(set) == 0 {
		return nil, errors.New("no fields to update in UpdateConversation")
	}
	set = append(set, "updated_ts = UNIX_TIMESTAMP()")
	args = append(args, update.ID)

	stmt := `
		UPDATE ` + "`conversation`" + `
		SET ` + strings.Join(set, ", ") + `
		WHERE id = ?
	`
	if _, err := tx.ExecContext(ctx, stmt, args...); err != nil {
		return nil, err
	}
	conv, err := d.findConversationImpl(ctx, tx, "id = ?", update.ID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return conv, nil
}

func (d *DB) DeleteConversation(ctx context.Context, id int32) error {
	if err := d.DeleteConversationMessages(ctx, id); err != nil {
		return err
	}
	_, err := d.db.ExecContext(ctx, "DELETE FROM `conversation` WHERE id = ?", id)
	return err
}

func (d *DB) CreateConversationMessage(ctx context.Context, create *store.CreateConversationMessage) (*store.ConversationMessage, error) {
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	stmt := `
		INSERT INTO ` + "`conversation_message`" + ` (
			conversation_id, role, content, tool_calls, tool_call_id, name
		)
		VALUES (?, ?, ?, ?, ?, ?)
	`
	result, err := tx.ExecContext(ctx, stmt, create.ConversationID, create.Role, create.Content, create.ToolCalls, create.ToolCallID, create.Name)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	query := `
		SELECT
			id, conversation_id, role, content, tool_calls, tool_call_id, name, created_ts, updated_ts
		FROM ` + "`conversation_message`" + `
		WHERE id = ?
		LIMIT 1
	`
	msg := &store.ConversationMessage{}
	if err := tx.QueryRowContext(ctx, query, id).Scan(
		&msg.ID, &msg.ConversationID, &msg.Role, &msg.Content, &msg.ToolCalls, &msg.ToolCallID, &msg.Name, &msg.CreatedTs, &msg.UpdatedTs,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return msg, nil
}

func (d *DB) ListConversationMessages(ctx context.Context, find *store.FindConversationMessage) ([]*store.ConversationMessage, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		where, args = append(where, "id = ?"), append(args, *find.ID)
	}
	if find.ConversationID != nil {
		where, args = append(where, "conversation_id = ?"), append(args, *find.ConversationID)
	}
	query := `
		SELECT
			id, conversation_id, role, content, tool_calls, tool_call_id, name, created_ts, updated_ts
		FROM ` + "`conversation_message`" + `
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY created_ts ASC
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

	list := []*store.ConversationMessage{}
	for rows.Next() {
		msg := &store.ConversationMessage{}
		if err := rows.Scan(
			&msg.ID, &msg.ConversationID, &msg.Role, &msg.Content, &msg.ToolCalls, &msg.ToolCallID, &msg.Name, &msg.CreatedTs, &msg.UpdatedTs,
		); err != nil {
			return nil, err
		}
		list = append(list, msg)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return list, nil
}

func (d *DB) DeleteConversationMessages(ctx context.Context, conversationID int32) error {
	_, err := d.db.ExecContext(ctx, "DELETE FROM `conversation_message` WHERE conversation_id = ?", conversationID)
	return err
}

func (d *DB) UpdateConversationMessage(ctx context.Context, update *store.UpdateConversationMessage) error {
	set, args := []string{}, []any{}
	if update.Content != nil {
		set, args = append(set, "`content` = ?"), append(args, *update.Content)
	}
	if update.Role != nil {
		set, args = append(set, "`role` = ?"), append(args, *update.Role)
	}
	if update.Name != nil {
		set, args = append(set, "`name` = ?"), append(args, *update.Name)
	}
	if len(set) == 0 {
		return nil
	}
	set = append(set, "`updated_ts` = UNIX_TIMESTAMP()")
	args = append(args, update.ID)
	stmt := `UPDATE ` + "`conversation_message`" + ` SET ` + strings.Join(set, ", ") + ` WHERE id = ?`
	_, err := d.db.ExecContext(ctx, stmt, args...)
	return err
}
