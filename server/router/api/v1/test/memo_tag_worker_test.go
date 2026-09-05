package test

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func createTestMemo(ctx context.Context, t *testing.T, ts *TestService, creatorID int32, content string, tags []string) *store.Memo {
	t.Helper()
	memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "memo-" + strings.ReplaceAll(content, " ", "-"),
		CreatorID:  creatorID,
		Content:    content,
		Visibility: store.Public,
		Payload:    &storepb.MemoPayload{Tags: tags},
	})
	require.NoError(t, err)
	return memo
}

// TestAutoTagMemoRPC keeps the public RPC contract aligned with the current
// AI product scope: legacy auto-tagging is no longer exposed.
func TestAutoTagMemoRPC(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	host, err := ts.CreateHostUser(ctx, "autotag-rpc-admin")
	require.NoError(t, err)
	adminCtx := ts.CreateUserContext(ctx, host.ID)

	memo := createTestMemo(ctx, t, ts, host.ID, "rpc memo", nil)

	_, err = ts.Service.AutoTagMemo(adminCtx, &v1pb.AutoTagMemoRequest{
		Name: "memos/" + memo.UID,
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "AI auto-tagging has been removed")
}
