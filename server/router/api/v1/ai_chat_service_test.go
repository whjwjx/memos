package v1

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/test"
)

func newTestAIChatService(t *testing.T) (*APIV1Service, *store.User, context.Context) {
	ctx := context.Background()
	s := &APIV1Service{
		Store: test.NewTestingStore(ctx, t),
	}
	user, err := s.Store.CreateUser(ctx, &store.User{
		Username:     "chat-user",
		Role:         store.RoleUser,
		PasswordHash: "hash",
	})
	require.NoError(t, err)
	require.NotZero(t, user.ID, "created user should have an ID")
	authedCtx := auth.SetUserInContext(ctx, user, "")
	return s, user, authedCtx
}

func TestAIChatRequiresAuth(t *testing.T) {
	s, _, _ := newTestAIChatService(t)
	defer s.Store.Close()
	_, err := s.CreateConversation(context.Background(), &connect.Request[v1pb.CreateConversationRequest]{Msg: &v1pb.CreateConversationRequest{}})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.Unauthenticated, st.Code())
}

func TestAIChatConversationCRUD(t *testing.T) {
	s, _, ctx := newTestAIChatService(t)
	defer s.Store.Close()

	// Create.
	created, err := s.CreateConversation(ctx, &connect.Request[v1pb.CreateConversationRequest]{
		Msg: &v1pb.CreateConversationRequest{Title: "my chat", AgentId: "default"},
	})
	require.NoError(t, err)
	require.NotEmpty(t, created.Msg.Id)
	require.Equal(t, "my chat", created.Msg.Title)

	// List.
	list, err := s.ListConversations(ctx, &connect.Request[v1pb.ListConversationsRequest]{Msg: &v1pb.ListConversationsRequest{}})
	require.NoError(t, err)
	require.Len(t, list.Msg.Conversations, 1)

	// Get.
	got, err := s.GetConversation(ctx, &connect.Request[v1pb.GetConversationRequest]{
		Msg: &v1pb.GetConversationRequest{Id: created.Msg.Id},
	})
	require.NoError(t, err)
	require.Equal(t, created.Msg.Id, got.Msg.Conversation.Id)

	// Delete.
	_, err = s.DeleteConversation(ctx, &connect.Request[v1pb.DeleteConversationRequest]{
		Msg: &v1pb.DeleteConversationRequest{Id: created.Msg.Id},
	})
	require.NoError(t, err)

	list, err = s.ListConversations(ctx, &connect.Request[v1pb.ListConversationsRequest]{Msg: &v1pb.ListConversationsRequest{}})
	require.NoError(t, err)
	require.Empty(t, list.Msg.Conversations)
}

func TestAIChatGetMissingReturnsNotFound(t *testing.T) {
	s, _, ctx := newTestAIChatService(t)
	defer s.Store.Close()
	_, err := s.GetConversation(ctx, &connect.Request[v1pb.GetConversationRequest]{Msg: &v1pb.GetConversationRequest{Id: "does-not-exist"}})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.NotFound, st.Code())
}
