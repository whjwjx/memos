package v1

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/profile"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/test"
)

func TestWalkLocalStorage_SumsFileSizes(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "a.txt"), []byte("hello"), 0o600))  // 5
	require.NoError(t, os.WriteFile(filepath.Join(dir, "b.txt"), []byte("world!"), 0o600)) // 6
	sub := filepath.Join(dir, "sub")
	require.NoError(t, os.Mkdir(sub, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(sub, "c.txt"), []byte("xx"), 0o600)) // 2

	size, err := walkLocalStorage(dir)
	require.NoError(t, err)
	require.Equal(t, int64(13), size)
}

func TestWalkLocalStorage_EmptyDir(t *testing.T) {
	size, err := walkLocalStorage("")
	require.Error(t, err)
	require.Equal(t, int64(-1), size)
}

func TestWalkLocalStorage_NonexistentDir(t *testing.T) {
	size, err := walkLocalStorage(filepath.Join(t.TempDir(), "does-not-exist"))
	require.Error(t, err)
	require.Equal(t, int64(-1), size)
}

func TestGetInstanceLogStats(t *testing.T) {
	ctx := context.Background()
	s := &APIV1Service{Store: test.NewTestingStore(ctx, t)}
	defer s.Store.Close()

	// Prepare a fake data directory with a few log files. Files that do not
	// match the memos-*.log pattern must be ignored.
	dataDir := t.TempDir()
	s.Profile = &profile.Profile{Data: dataDir}
	logsDir := filepath.Join(dataDir, "logs")
	require.NoError(t, os.MkdirAll(logsDir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(logsDir, "memos-2026-08-01.log"), []byte("a"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(logsDir, "memos-2026-08-02.log"), []byte("bb"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(logsDir, "unrelated.txt"), []byte("cc"), 0o644))

	admin, err := s.Store.CreateUser(ctx, &store.User{
		Username:     "log-admin",
		Role:         store.RoleAdmin,
		PasswordHash: "hash",
	})
	require.NoError(t, err)
	adminCtx := auth.SetUserInContext(ctx, admin, "")

	resp, err := s.GetInstanceLogStats(adminCtx, &v1pb.GetInstanceLogStatsRequest{})
	require.NoError(t, err)
	require.Equal(t, int32(2), resp.FileCount)
	require.Equal(t, int64(3), resp.TotalBytes)

	user, err := s.Store.CreateUser(ctx, &store.User{
		Username:     "log-user",
		Role:         store.RoleUser,
		PasswordHash: "hash",
	})
	require.NoError(t, err)
	userCtx := auth.SetUserInContext(ctx, user, "")

	_, err = s.GetInstanceLogStats(userCtx, &v1pb.GetInstanceLogStatsRequest{})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	require.Equal(t, codes.PermissionDenied, st.Code())

	// Unauthenticated access is rejected.
	_, err = s.GetInstanceLogStats(ctx, &v1pb.GetInstanceLogStatsRequest{})
	require.Error(t, err)

	// Missing logs directory yields empty stats rather than an error.
	s2 := &APIV1Service{Store: s.Store, Profile: &profile.Profile{Data: t.TempDir()}}
	resp, err = s2.GetInstanceLogStats(adminCtx, &v1pb.GetInstanceLogStatsRequest{})
	require.NoError(t, err)
	require.Equal(t, int32(0), resp.FileCount)
	require.Equal(t, int64(0), resp.TotalBytes)
}
