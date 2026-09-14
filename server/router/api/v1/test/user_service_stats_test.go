package test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestGetUserStats_TagCount(t *testing.T) {
	ctx := context.Background()

	// Create test service
	ts := NewTestService(t)
	defer ts.Cleanup()

	// Create a test host user
	user, err := ts.CreateHostUser(ctx, "test-user")
	require.NoError(t, err)

	// Create user context for authentication
	userCtx := ts.CreateUserContext(ctx, user.ID)

	// Create a memo with a single tag
	memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "test-memo-1",
		CreatorID:  user.ID,
		Content:    "This is a test memo with #test tag",
		Visibility: store.Public,
		Payload: &storepb.MemoPayload{
			Tags: []string{"test", "test"},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, memo)

	// Test GetUserStats
	userName := fmt.Sprintf("users/%s", user.Username)
	response, err := ts.Service.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{
		Name: userName,
	})
	require.NoError(t, err)
	require.NotNil(t, response)
	require.Equal(t, fmt.Sprintf("users/%s/stats", user.Username), response.Name)

	// A memo contributes at most once to an exact tag count, even if its payload
	// accidentally contains the same derived membership more than once.
	require.Contains(t, response.TagCount, "test")
	require.Equal(t, int32(1), response.TagCount["test"], "Tag count should be 1 for a single occurrence")

	// Create another memo with the same tag
	memo2, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "test-memo-2",
		CreatorID:  user.ID,
		Content:    "Another memo with #test tag",
		Visibility: store.Public,
		Payload: &storepb.MemoPayload{
			Tags: []string{"test"},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, memo2)

	// Test GetUserStats again
	response2, err := ts.Service.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{
		Name: userName,
	})
	require.NoError(t, err)
	require.NotNil(t, response2)

	// Check that the tag count is exactly 2, not 3
	require.Contains(t, response2.TagCount, "test")
	require.Equal(t, int32(2), response2.TagCount["test"], "Tag count should be 2 for two occurrences")

	// Test with a new unique tag
	memo3, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "test-memo-3",
		CreatorID:  user.ID,
		Content:    "Memo with #unique tag",
		Visibility: store.Public,
		Payload: &storepb.MemoPayload{
			Tags: []string{"unique"},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, memo3)

	// Test GetUserStats for the new tag
	response3, err := ts.Service.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{
		Name: userName,
	})
	require.NoError(t, err)
	require.NotNil(t, response3)

	// Check that the unique tag count is exactly 1
	require.Contains(t, response3.TagCount, "unique")
	require.Equal(t, int32(1), response3.TagCount["unique"], "New tag count should be 1 for first occurrence")

	// The original test tag should still be 2
	require.Contains(t, response3.TagCount, "test")
	require.Equal(t, int32(2), response3.TagCount["test"], "Original tag count should remain 2")

	_, err = ts.Service.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{
		Name: "users/1",
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "user not found")
}

func TestGetUserStats_TagCountPreservesExactIdentity(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	const (
		composedTag   = "caf\u00e9"
		decomposedTag = "cafe\u0301"
	)

	user, err := ts.CreateHostUser(ctx, "exact-tag-stats-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	_, err = ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "exact-tag-stats-memo",
		CreatorID:  user.ID,
		Content:    "Exact tag membership fixture",
		Visibility: store.Public,
		Payload: &storepb.MemoPayload{
			Tags: []string{"book", "book/fiction", "book", "Work", "work", composedTag, decomposedTag},
		},
	})
	require.NoError(t, err)

	response, err := ts.Service.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{
		Name: fmt.Sprintf("users/%s", user.Username),
	})
	require.NoError(t, err)
	require.Equal(t, map[string]int32{
		"book":         1,
		"book/fiction": 1,
		"Work":         1,
		"work":         1,
		composedTag:    1,
		decomposedTag:  1,
	}, response.TagCount)
}

func TestGetUserStats_MemoUpdatedTimestamps(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "ts-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "ts-memo-1",
		CreatorID:  user.ID,
		Content:    "first content",
		Visibility: store.Public,
	})
	require.NoError(t, err)
	require.NotNil(t, memo)

	// SQLite UpdateMemo only sets fields explicitly passed (created_ts default
	// fires on INSERT only). So bump updated_ts explicitly to simulate an edit
	// happening after creation.
	newContent := "second content"
	newUpdatedTs := memo.UpdatedTs + 100
	require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{
		ID:        memo.ID,
		Content:   &newContent,
		UpdatedTs: &newUpdatedTs,
	}))

	userName := fmt.Sprintf("users/%s", user.Username)
	resp, err := ts.Service.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{Name: userName})
	require.NoError(t, err)
	require.NotNil(t, resp)

	require.Len(t, resp.MemoCreatedTimestamps, 1, "should have one created timestamp")
	require.Len(t, resp.MemoUpdatedTimestamps, 1, "should have one updated timestamp")

	require.Equal(t, memo.CreatedTs, resp.MemoCreatedTimestamps[0].AsTime().Unix())
	require.Equal(t, newUpdatedTs, resp.MemoUpdatedTimestamps[0].AsTime().Unix())
	require.Greater(
		t,
		resp.MemoUpdatedTimestamps[0].AsTime().Unix(),
		resp.MemoCreatedTimestamps[0].AsTime().Unix(),
		"updated_ts should be after created_ts after an edit",
	)
}

func TestGetUserStats_PinnedMemoUsesCanonicalResourceName(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "pinned-stats-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	memo, err := ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "pinned-stats-memo",
		CreatorID:  user.ID,
		Content:    "pinned",
		Visibility: store.Public,
	})
	require.NoError(t, err)
	pinned := true
	require.NoError(t, ts.Store.UpdateMemo(ctx, &store.UpdateMemo{ID: memo.ID, Pinned: &pinned}))

	resp, err := ts.Service.GetUserStats(userCtx, &v1pb.GetUserStatsRequest{Name: fmt.Sprintf("users/%s", user.Username)})
	require.NoError(t, err)
	require.Equal(t, []string{"memos/pinned-stats-memo"}, resp.PinnedMemos)
}

func TestGetUserProfileStats_UsesVisibleStatsByDefaultAndFullStatsWhenEnabled(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "profile-stats-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	now := time.Now().In(time.Local)
	today := time.Date(now.Year(), now.Month(), now.Day(), 8, 0, 0, 0, time.Local).Unix()
	yesterday := time.Date(now.Year(), now.Month(), now.Day()-1, 8, 0, 0, 0, time.Local).Unix()

	_, err = ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "profile-stats-public",
		CreatorID:  user.ID,
		CreatedTs:  today,
		Content:    "public memo",
		Visibility: store.Public,
		Payload:    &storepb.MemoPayload{Tags: []string{"public", "public"}},
	})
	require.NoError(t, err)
	_, err = ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "profile-stats-private",
		CreatorID:  user.ID,
		CreatedTs:  yesterday,
		Content:    "private memo",
		Visibility: store.Private,
		Payload:    &storepb.MemoPayload{Tags: []string{"private"}},
	})
	require.NoError(t, err)

	userName := fmt.Sprintf("users/%s", user.Username)
	defaultResp, err := ts.Service.GetUserProfileStats(ctx, &v1pb.GetUserProfileStatsRequest{Name: userName})
	require.NoError(t, err)
	require.Equal(t, fmt.Sprintf("%s/profileStats", userName), defaultResp.Name)
	require.False(t, defaultResp.IncludesAllMemos)
	require.Equal(t, int32(1), defaultResp.TotalMemoCount)
	require.Equal(t, int32(1), defaultResp.TotalTagCount)
	require.Equal(t, int32(1), defaultResp.ActiveDayCount)
	require.Equal(t, int32(1), defaultResp.YearMemoCount)
	require.Len(t, defaultResp.DailyActivity, 1)
	require.Equal(t, time.Unix(today, 0).In(time.Local).Format("2006-01-02"), defaultResp.DailyActivity[0].Date)
	require.Equal(t, int32(1), defaultResp.DailyActivity[0].Count)

	_, err = ts.Service.UpdateUserSetting(userCtx, &v1pb.UpdateUserSettingRequest{
		Setting: &v1pb.UserSetting{
			Name: fmt.Sprintf("%s/settings/GENERAL", userName),
			Value: &v1pb.UserSetting_GeneralSetting_{
				GeneralSetting: &v1pb.UserSetting_GeneralSetting{ShowFullProfileStats: true},
			},
		},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"show_full_profile_stats"}},
	})
	require.NoError(t, err)

	fullResp, err := ts.Service.GetUserProfileStats(ctx, &v1pb.GetUserProfileStatsRequest{Name: userName})
	require.NoError(t, err)
	require.True(t, fullResp.IncludesAllMemos)
	require.Equal(t, int32(2), fullResp.TotalMemoCount)
	require.Equal(t, int32(2), fullResp.TotalTagCount)
	require.Equal(t, int32(2), fullResp.ActiveDayCount)
	require.Equal(t, int32(2), fullResp.YearMemoCount)
	require.Equal(t, int32(2), fullResp.CurrentStreak)
	require.Equal(t, int32(2), fullResp.LongestStreak)
	require.Len(t, fullResp.DailyActivity, 2)
	require.Equal(t, time.Unix(yesterday, 0).In(time.Local).Format("2006-01-02"), fullResp.DailyActivity[0].Date)
	require.Equal(t, int32(1), fullResp.DailyActivity[0].Count)
	require.Equal(t, time.Unix(today, 0).In(time.Local).Format("2006-01-02"), fullResp.DailyActivity[1].Date)
	require.Equal(t, int32(1), fullResp.DailyActivity[1].Count)
}

func TestListAllUserStats_FilterExcludesPrivateMemos(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "stats-filter-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	_, err = ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "stats-filter-public",
		CreatorID:  user.ID,
		Content:    "public memo",
		Visibility: store.Public,
		Payload:    &storepb.MemoPayload{Tags: []string{"public", "public"}},
	})
	require.NoError(t, err)
	_, err = ts.Store.CreateMemo(ctx, &store.Memo{
		UID:        "stats-filter-private",
		CreatorID:  user.ID,
		Content:    "private memo",
		Visibility: store.Private,
		Payload:    &storepb.MemoPayload{Tags: []string{"private", "private"}},
	})
	require.NoError(t, err)

	unfilteredResp, err := ts.Service.ListAllUserStats(userCtx, &v1pb.ListAllUserStatsRequest{})
	require.NoError(t, err)
	require.Len(t, unfilteredResp.Stats, 1)
	require.Equal(t, int32(1), unfilteredResp.Stats[0].TagCount["public"])
	require.Equal(t, int32(1), unfilteredResp.Stats[0].TagCount["private"])

	filteredResp, err := ts.Service.ListAllUserStats(userCtx, &v1pb.ListAllUserStatsRequest{
		Filter: `visibility in ["PUBLIC", "PROTECTED"]`,
	})
	require.NoError(t, err)
	require.Len(t, filteredResp.Stats, 1)
	require.Equal(t, int32(1), filteredResp.Stats[0].TagCount["public"])
	require.NotContains(t, filteredResp.Stats[0].TagCount, "private")
}
