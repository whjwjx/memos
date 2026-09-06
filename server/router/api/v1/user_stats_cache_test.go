package v1

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

func TestUserStatsCacheInvalidatesAfterMemoMutation(t *testing.T) {
	ctx := context.Background()
	stores := teststore.NewTestingStore(ctx, t)
	defer stores.Close()

	s := NewAPIV1Service("test-secret", &profile.Profile{Data: stores.GetDataDir(), InstanceURL: "http://localhost:8080"}, stores)
	user, err := stores.CreateUser(ctx, &store.User{
		Username: "stats-cache-user",
		Role:     store.RoleUser,
		Email:    "stats-cache-user@example.com",
	})
	require.NoError(t, err)
	userCtx := auth.SetUserInContext(ctx, user, "")
	userName := BuildUserName(user.Username)

	resp, err := s.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{Name: userName})
	require.NoError(t, err)
	require.Equal(t, int32(0), resp.TotalMemoCount)

	_, err = s.CreateMemo(userCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{
			Content:    "#cache warmed",
			Visibility: v1pb.Visibility_PRIVATE,
		},
	})
	require.NoError(t, err)

	resp, err = s.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{Name: userName})
	require.NoError(t, err)
	require.Equal(t, int32(1), resp.TotalMemoCount)
	require.Equal(t, int32(1), resp.TagCount["cache"])
}
