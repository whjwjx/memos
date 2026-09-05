package v1

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/usememos/memos/internal/ai/tools"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
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

	_, err = s.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{
			ChatAgents: []*storepb.ChatAgentConfig{
				{Id: "research", Name: "Research", Enabled: true},
			},
		}},
	})
	require.NoError(t, err)
	updated, err := s.UpdateConversation(ctx, &connect.Request[v1pb.UpdateConversationRequest]{
		Msg: &v1pb.UpdateConversationRequest{
			Conversation: &v1pb.Conversation{Id: created.Msg.Id, AgentId: "research"},
			UpdateMask:   &fieldmaskpb.FieldMask{Paths: []string{"agent_id"}},
		},
	})
	require.NoError(t, err)
	require.Equal(t, "research", updated.Msg.AgentId)

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

func TestApplyToolConfigScopeIsolation(t *testing.T) {
	s, user, ctx := newTestAIChatService(t)
	defer s.Store.Close()
	require.Equal(t, store.RoleUser, user.Role)

	admin, err := s.Store.CreateUser(ctx, &store.User{
		Username:     "chat-admin",
		Role:         store.RoleAdmin,
		PasswordHash: "hash",
	})
	require.NoError(t, err)

	// Save per-tool config: search_memos disabled, delete_memo explicitly set to
	// no confirmation (differs from its built-in default).
	_, err = s.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{
			Tools: map[string]*storepb.ToolConfig{
				"search_memos": {Enabled: false},
				"delete_memo":  {Enabled: true, RequiresConfirmation: false},
			},
		}},
	})
	require.NoError(t, err)

	t.Run("non-admin cannot see admin-only tools", func(t *testing.T) {
		registry := tools.NewRegistry()
		s.applyToolConfig(ctx, registry, user.ID)

		// Admin-only tools are removed entirely for non-admin users.
		require.Nil(t, registry.Get("get_logs"))
		require.Nil(t, registry.Get("query_db"))
		require.Nil(t, registry.Get("query_queue"))
		require.Nil(t, registry.Get("project_status"))
		// Disabled tools are removed entirely too.
		require.Nil(t, registry.Get("search_memos"))
		// Explicitly configured confirmation is honored.
		require.False(t, registry.Get("delete_memo").RequiresConfirmation(""))
		// Unconfigured tools keep their built-in behavior: mutating tools
		// require confirmation, read-only ones don't.
		require.True(t, registry.Get("create_memo").RequiresConfirmation(""))
		require.False(t, registry.Get("get_comments").RequiresConfirmation(""))
	})

	t.Run("admin keeps admin-only tools", func(t *testing.T) {
		registry := tools.NewRegistry()
		s.applyToolConfig(ctx, registry, admin.ID)

		require.NotNil(t, registry.Get("get_logs"))
		require.NotNil(t, registry.Get("query_db"))
		require.NotNil(t, registry.Get("query_queue"))
		require.NotNil(t, registry.Get("project_status"))
		require.Nil(t, registry.Get("search_memos"))
		require.False(t, registry.Get("delete_memo").RequiresConfirmation(""))
	})

	t.Run("no saved config keeps full default registry", func(t *testing.T) {
		ctx2 := context.Background()
		s2, user2, _ := newTestAIChatService(t)
		defer s2.Store.Close()

		registry := tools.NewRegistry()
		s2.applyToolConfig(ctx2, registry, user2.ID)

		// Non-admin still loses admin-only tools...
		require.Nil(t, registry.Get("get_logs"))
		require.Nil(t, registry.Get("query_db"))
		require.Nil(t, registry.Get("query_queue"))
		require.Nil(t, registry.Get("project_status"))
		// ...but all non-admin tools are enabled with built-in confirmation.
		require.NotNil(t, registry.Get("search_memos"))
		require.NotNil(t, registry.Get("create_memo"))
	})
}
