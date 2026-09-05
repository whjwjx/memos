package store

import (
	"context"
)

// Conversation is an AI chat session owned by a single user.
type Conversation struct {
	ID        int32
	UID       string
	UserID    int32
	Title     string
	AgentID   string
	LLMID     string
	CreatedTs int64
	UpdatedTs int64
}

// ConversationMessage is a single turn within a conversation. ToolCalls holds a
// JSON array of chat.ToolCall when the assistant requested tool invocations;
// ToolCallID/Name identify the originating tool call for role=="tool" results so
// the model can correlate results back to the matching assistant tool_calls turn.
type ConversationMessage struct {
	ID             int32
	ConversationID int32
	Role           string
	Content        string
	ToolCalls      string
	ToolCallID     string
	Name           string
	CreatedTs      int64
	UpdatedTs      int64
}

// CreateConversation is the input for starting a new conversation.
type CreateConversation struct {
	UID     string
	UserID  int32
	Title   string
	AgentID string
	LLMID   string
}

// FindConversation filters conversations.
type FindConversation struct {
	ID     *int32
	UID    *string
	UserID *int32
	// Limit/Offset for pagination.
	Limit  *int
	Offset *int
}

// UpdateConversation mutates a conversation, typically its title.
type UpdateConversation struct {
	ID      int32
	Title   *string
	AgentID *string
	LLMID   *string
}

// CreateConversationMessage is the input for appending a message.
type CreateConversationMessage struct {
	ConversationID int32
	Role           string
	Content        string
	ToolCalls      string
	ToolCallID     string
	Name           string
}

// UpdateConversationMessage patches mutable fields of an existing message. Used to
// replace a pending "awaiting confirmation" tool message with its real result once
// the user approves the call.
type UpdateConversationMessage struct {
	ID      int32
	Content *string
	Role    *string
	Name    *string
}

// FindConversationMessage filters messages within a conversation.
type FindConversationMessage struct {
	ID             *int32
	ConversationID *int32
	// Limit/Offset for pagination; results are ordered by created_ts ascending.
	Limit  *int
	Offset *int
}

func (s *Store) CreateConversation(ctx context.Context, create *CreateConversation) (*Conversation, error) {
	return s.driver.CreateConversation(ctx, create)
}

func (s *Store) GetConversation(ctx context.Context, find *FindConversation) (*Conversation, error) {
	list, err := s.driver.ListConversations(ctx, find)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, nil
	}
	return list[0], nil
}

func (s *Store) ListConversations(ctx context.Context, find *FindConversation) ([]*Conversation, error) {
	return s.driver.ListConversations(ctx, find)
}

func (s *Store) UpdateConversation(ctx context.Context, update *UpdateConversation) (*Conversation, error) {
	return s.driver.UpdateConversation(ctx, update)
}

func (s *Store) DeleteConversation(ctx context.Context, id int32) error {
	return s.driver.DeleteConversation(ctx, id)
}

func (s *Store) CreateConversationMessage(ctx context.Context, create *CreateConversationMessage) (*ConversationMessage, error) {
	return s.driver.CreateConversationMessage(ctx, create)
}

func (s *Store) ListConversationMessages(ctx context.Context, find *FindConversationMessage) ([]*ConversationMessage, error) {
	return s.driver.ListConversationMessages(ctx, find)
}

func (s *Store) DeleteConversationMessages(ctx context.Context, conversationID int32) error {
	return s.driver.DeleteConversationMessages(ctx, conversationID)
}

func (s *Store) UpdateConversationMessage(ctx context.Context, update *UpdateConversationMessage) error {
	return s.driver.UpdateConversationMessage(ctx, update)
}
