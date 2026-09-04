package store_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/test"
)

func TestConversationCRUD(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer s.Close()

	conv, err := s.CreateConversation(ctx, &store.CreateConversation{
		UID:     "conv-1",
		UserID:  101,
		Title:   "First chat",
		AgentID: "default",
		LLMID:   "llm-default",
	})
	require.NoError(t, err)
	require.NotZero(t, conv.ID)
	require.Equal(t, int32(101), conv.UserID)
	require.Equal(t, "llm-default", conv.LLMID)

	// List by user.
	userID := int32(101)
	list, err := s.ListConversations(ctx, &store.FindConversation{UserID: &userID})
	require.NoError(t, err)
	require.Len(t, list, 1)
	require.Equal(t, "llm-default", list[0].LLMID)

	// Update title and LLM selection.
	title := "Renamed"
	agentID := "research"
	llmID := "llm-fast"
	updated, err := s.UpdateConversation(ctx, &store.UpdateConversation{ID: conv.ID, Title: &title, AgentID: &agentID, LLMID: &llmID})
	require.NoError(t, err)
	require.Equal(t, "Renamed", updated.Title)
	require.Equal(t, "research", updated.AgentID)
	require.Equal(t, "llm-fast", updated.LLMID)

	// Append messages.
	userMsg, err := s.CreateConversationMessage(ctx, &store.CreateConversationMessage{
		ConversationID: conv.ID,
		Role:           "user",
		Content:        "hello",
	})
	require.NoError(t, err)
	require.Equal(t, "hello", userMsg.Content)

	assistantMsg, err := s.CreateConversationMessage(ctx, &store.CreateConversationMessage{
		ConversationID: conv.ID,
		Role:           "assistant",
		Content:        "",
		ToolCalls:      `[{"id":"c1","name":"search_memos","arguments":"{}"}]`,
	})
	require.NoError(t, err)
	require.Contains(t, assistantMsg.ToolCalls, "search_memos")

	// List messages ordered by created_ts.
	msgs, err := s.ListConversationMessages(ctx, &store.FindConversationMessage{ConversationID: &conv.ID})
	require.NoError(t, err)
	require.Len(t, msgs, 2)
	require.Equal(t, "user", msgs[0].Role)
	require.Equal(t, "assistant", msgs[1].Role)

	// Delete cascade.
	require.NoError(t, s.DeleteConversation(ctx, conv.ID))
	msgs, err = s.ListConversationMessages(ctx, &store.FindConversationMessage{ConversationID: &conv.ID})
	require.NoError(t, err)
	require.Empty(t, msgs)
}
