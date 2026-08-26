package postgres

import (
	"context"
	"fmt"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

func (d *DB) CreateConversation(ctx context.Context, create *store.CreateConversation) (*store.Conversation, error) {
	stmt := `
		INSERT INTO conversation (
			uid, user_id, title, agent_id
		)
		VALUES ($1, $2, $3, $4)
		RETURNING
			id, uid, user_id, title, agent_id, created_ts, updated_ts
	`
	conv := &store.Conversation{}
	if err := d.db.QueryRowContext(ctx, stmt,
		create.UID, create.UserID, create.Title, create.AgentID,
	).Scan(
		&conv.ID,
		&conv.UID,
		&conv.UserID,
		&conv.Title,
		&conv.AgentID,
		&conv.CreatedTs,
		&conv.UpdatedTs,
	); err != nil {
		return nil, err
	}
	return conv, nil
}

func (d *DB) ListConversations(ctx context.Context, find *store.FindConversation) ([]*store.Conversation, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		args = append(args, *find.ID)
		where = append(where, fmt.Sprintf("id = $%d", len(args)))
	}
	if find.UID != nil {
		args = append(args, *find.UID)
		where = append(where, fmt.Sprintf("uid = $%d", len(args)))
	}
	if find.UserID != nil {
		args = append(args, *find.UserID)
		where = append(where, fmt.Sprintf("user_id = $%d", len(args)))
	}
	query := `
		SELECT
			id, uid, user_id, title, agent_id, created_ts, updated_ts
		FROM conversation
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
			&conv.ID, &conv.UID, &conv.UserID, &conv.Title, &conv.AgentID, &conv.CreatedTs, &conv.UpdatedTs,
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
	set, args := []string{}, []any{}
	if update.Title != nil {
		args = append(args, *update.Title)
		set = append(set, fmt.Sprintf("title = $%d", len(args)))
	}
	if len(set) == 0 {
		return nil, errors.New("no fields to update in UpdateConversation")
	}
	args = append(args, update.ID)
	set = append(set, "updated_ts = EXTRACT(EPOCH FROM NOW())")

	stmt := `
		UPDATE conversation
		SET ` + strings.Join(set, ", ") + `
		WHERE id = $` + fmt.Sprintf("%d", len(args)) + `
		RETURNING id, uid, user_id, title, agent_id, created_ts, updated_ts
	`
	conv := &store.Conversation{}
	if err := d.db.QueryRowContext(ctx, stmt, args...).Scan(
		&conv.ID, &conv.UID, &conv.UserID, &conv.Title, &conv.AgentID, &conv.CreatedTs, &conv.UpdatedTs,
	); err != nil {
		return nil, err
	}
	return conv, nil
}

func (d *DB) DeleteConversation(ctx context.Context, id int32) error {
	if err := d.DeleteConversationMessages(ctx, id); err != nil {
		return err
	}
	_, err := d.db.ExecContext(ctx, "DELETE FROM conversation WHERE id = $1", id)
	return err
}

func (d *DB) CreateConversationMessage(ctx context.Context, create *store.CreateConversationMessage) (*store.ConversationMessage, error) {
	stmt := `
		INSERT INTO conversation_message (
			conversation_id, role, content, tool_calls, tool_call_id, name
		)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING
			id, conversation_id, role, content, tool_calls, tool_call_id, name, created_ts, updated_ts
	`
	msg := &store.ConversationMessage{}
	if err := d.db.QueryRowContext(ctx, stmt,
		create.ConversationID, create.Role, create.Content, create.ToolCalls, create.ToolCallID, create.Name,
	).Scan(
		&msg.ID,
		&msg.ConversationID,
		&msg.Role,
		&msg.Content,
		&msg.ToolCalls,
		&msg.ToolCallID,
		&msg.Name,
		&msg.CreatedTs,
		&msg.UpdatedTs,
	); err != nil {
		return nil, err
	}
	return msg, nil
}

func (d *DB) ListConversationMessages(ctx context.Context, find *store.FindConversationMessage) ([]*store.ConversationMessage, error) {
	where, args := []string{"1 = 1"}, []any{}
	if find.ID != nil {
		args = append(args, *find.ID)
		where = append(where, fmt.Sprintf("id = $%d", len(args)))
	}
	if find.ConversationID != nil {
		args = append(args, *find.ConversationID)
		where = append(where, fmt.Sprintf("conversation_id = $%d", len(args)))
	}
	query := `
		SELECT
			id, conversation_id, role, content, tool_calls, tool_call_id, name, created_ts, updated_ts
		FROM conversation_message
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
	_, err := d.db.ExecContext(ctx, "DELETE FROM conversation_message WHERE conversation_id = $1", conversationID)
	return err
}

func (d *DB) UpdateConversationMessage(ctx context.Context, update *store.UpdateConversationMessage) error {
	set, args := []string{}, []any{}
	if update.Content != nil {
		set, args = append(set, "content = $"+fmt.Sprint(len(args)+1)), append(args, *update.Content)
	}
	if update.Role != nil {
		set, args = append(set, "role = $"+fmt.Sprint(len(args)+1)), append(args, *update.Role)
	}
	if update.Name != nil {
		set, args = append(set, "name = $"+fmt.Sprint(len(args)+1)), append(args, *update.Name)
	}
	if len(set) == 0 {
		return nil
	}
	set = append(set, "updated_ts = EXTRACT(EPOCH FROM NOW())")
	args = append(args, update.ID)
	stmt := `UPDATE conversation_message SET ` + strings.Join(set, ", ") + ` WHERE id = $` + fmt.Sprint(len(args))
	_, err := d.db.ExecContext(ctx, stmt, args...)
	return err
}
