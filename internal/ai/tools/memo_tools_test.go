package tools_test

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/ai/tools"
	"github.com/usememos/memos/internal/markdown"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
	"github.com/usememos/memos/store/test"
)

func TestSearchMemosFiltersPinnedAndTags(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	user := createQueryDBTestUser(t, ctx, s, "memo-tools-search", store.RoleUser)
	pinned := createMemoWithPayload(t, ctx, s, user.ID, "memo-tools-pinned", "Pinned #work", store.Private)
	createMemoWithPayload(t, ctx, s, user.ID, "memo-tools-other", "Other #work", store.Private)
	require.NoError(t, s.UpdateMemo(ctx, &store.UpdateMemo{ID: pinned.ID, Pinned: boolPtr(true)}))

	tool := tools.NewRegistry().Get("search_memos")
	require.NotNil(t, tool)
	result, err := tool.Run(ctx, tools.ToolContext{UserID: user.ID, Store: s}, `{"tags":["work"],"pinned":true}`)
	require.NoError(t, err)
	require.Contains(t, result, "memo-tools-pinned")
	require.NotContains(t, result, "memo-tools-other")
	require.Contains(t, result, `"pinned":true`)
	require.Contains(t, result, `"tags":["work"]`)
}

func TestCreateMemoRebuildsPayload(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	user := createQueryDBTestUser(t, ctx, s, "memo-tools-create", store.RoleUser)

	tool := tools.NewRegistry().Get("create_memo")
	require.NotNil(t, tool)
	_, err := tool.Run(ctx, tools.ToolContext{UserID: user.ID, Store: s}, `{"content":"new memo #created","visibility":"PRIVATE"}`)
	require.NoError(t, err)

	limit := 10
	memos, err := s.ListMemos(ctx, &store.FindMemo{CreatorID: &user.ID, Limit: &limit})
	require.NoError(t, err)
	require.Len(t, memos, 1)
	require.Equal(t, []string{"created"}, memos[0].Payload.GetTags())
}

func TestUpdateMemoUpdatesFieldsAndPayload(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	user := createQueryDBTestUser(t, ctx, s, "memo-tools-update", store.RoleUser)
	memo := createMemoWithPayload(t, ctx, s, user.ID, "memo-tools-update-1", "old #old", store.Private)

	tool := tools.NewRegistry().Get("update_memo")
	require.NotNil(t, tool)
	result, err := tool.Run(ctx, tools.ToolContext{UserID: user.ID, Store: s}, `{"memoUid":"memo-tools-update-1","content":"new #next","pinned":true,"state":"ARCHIVED","visibility":"PUBLIC"}`)
	require.NoError(t, err)
	require.Contains(t, result, `"pinned":true`)
	require.Contains(t, result, `"state":"ARCHIVED"`)

	updated, err := s.GetMemo(ctx, &store.FindMemo{ID: &memo.ID})
	require.NoError(t, err)
	require.Equal(t, "new #next", updated.Content)
	require.Equal(t, []string{"next"}, updated.Payload.GetTags())
	require.True(t, updated.Pinned)
	require.Equal(t, store.Archived, updated.RowStatus)
	require.Equal(t, store.Public, updated.Visibility)
}

func TestTagMemoAddsRemovesAndRenamesTags(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	user := createQueryDBTestUser(t, ctx, s, "memo-tools-tag", store.RoleUser)
	memo := createMemoWithPayload(t, ctx, s, user.ID, "memo-tools-tag-1", "hello #old `#code` [#link](https://example.com/#frag) #rename", store.Private)

	tool := tools.NewRegistry().Get("tag_memo")
	require.NotNil(t, tool)
	result, err := tool.Run(ctx, tools.ToolContext{UserID: user.ID, Store: s}, `{"memoUid":"memo-tools-tag-1","addTags":["new"],"removeTags":["old"],"renameTags":[{"from":"rename","to":"renamed"}]}`)
	require.NoError(t, err)
	require.Contains(t, result, `"changed":true`)

	updated, err := s.GetMemo(ctx, &store.FindMemo{ID: &memo.ID})
	require.NoError(t, err)
	require.NotContains(t, updated.Content, "#old")
	require.Contains(t, updated.Content, "`#code`")
	require.Contains(t, updated.Content, "[#link](https://example.com/#frag)")
	require.Contains(t, updated.Content, "#renamed")
	require.Contains(t, updated.Content, "#new")
	require.ElementsMatch(t, []string{"renamed", "new"}, updated.Payload.GetTags())
}

func TestBatchUpdateMemos(t *testing.T) {
	ctx := context.Background()
	s := test.NewTestingStore(ctx, t)
	defer func() { _ = s.Close() }()
	user := createQueryDBTestUser(t, ctx, s, "memo-tools-batch", store.RoleUser)
	first := createMemoWithPayload(t, ctx, s, user.ID, "memo-tools-batch-1", "first", store.Private)
	second := createMemoWithPayload(t, ctx, s, user.ID, "memo-tools-batch-2", "second", store.Private)

	tool := tools.NewRegistry().Get("batch_update_memos")
	require.NotNil(t, tool)
	result, err := tool.Run(ctx, tools.ToolContext{UserID: user.ID, Store: s}, `{"memoUids":["memo-tools-batch-1","memos/memo-tools-batch-2"],"addTags":["bulk"],"pinned":true,"state":"ARCHIVED"}`)
	require.NoError(t, err)
	require.Contains(t, result, `"memoUid":"memo-tools-batch-1"`)
	require.Contains(t, result, `"memoUid":"memo-tools-batch-2"`)

	for _, memoID := range []int32{first.ID, second.ID} {
		updated, err := s.GetMemo(ctx, &store.FindMemo{ID: &memoID})
		require.NoError(t, err)
		require.Contains(t, updated.Content, "#bulk")
		require.Equal(t, []string{"bulk"}, updated.Payload.GetTags())
		require.True(t, updated.Pinned)
		require.Equal(t, store.Archived, updated.RowStatus)
	}
}

func createMemoWithPayload(t *testing.T, ctx context.Context, s *store.Store, userID int32, uid string, content string, visibility store.Visibility) *store.Memo {
	t.Helper()
	payload := buildMemoPayload(t, content)
	memo, err := s.CreateMemo(ctx, &store.Memo{
		UID:        uid,
		CreatorID:  userID,
		Content:    content,
		Visibility: visibility,
		Payload:    payload,
	})
	require.NoError(t, err)
	return memo
}

func buildMemoPayload(t *testing.T, content string) *storepb.MemoPayload {
	t.Helper()
	svc := markdown.NewService(markdown.WithTagExtension(), markdown.WithMentionExtension())
	data, err := svc.ExtractAll([]byte(content))
	require.NoError(t, err)
	return &storepb.MemoPayload{
		Tags:     data.Tags,
		Property: data.Property,
	}
}

func boolPtr(v bool) *bool {
	return &v
}

func TestBatchUpdateRejectsLargeBatches(t *testing.T) {
	tool := tools.NewRegistry().Get("batch_update_memos")
	require.NotNil(t, tool)
	uids := make([]string, 51)
	for i := range uids {
		uids[i] = "memo-" + strings.Repeat("x", i+1)
	}
	_, err := tool.Run(context.Background(), tools.ToolContext{UserID: 1}, `{"memoUids":["`+strings.Join(uids, `","`)+`"],"pinned":true}`)
	require.Error(t, err)
	require.Contains(t, err.Error(), "maximum")
}
