package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/store"
)

// TagMemoTool edits tags on a single memo by updating its markdown content.
type TagMemoTool struct{}

type tagMemoArgs struct {
	MemoUID    string      `json:"memoUid"`
	AddTags    []string    `json:"addTags"`
	RemoveTags []string    `json:"removeTags"`
	RenameTags []tagRename `json:"renameTags"`
}

type tagMemoResult struct {
	MemoUID     string      `json:"memoUid"`
	AddedTags   []string    `json:"addedTags"`
	RemovedTags []string    `json:"removedTags"`
	RenamedTags []tagRename `json:"renamedTags"`
	Tags        []string    `json:"tags"`
	Changed     bool        `json:"changed"`
}

func (*TagMemoTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "tag_memo",
		Description: "Add, remove, or rename tags on one memo by editing its markdown content and rebuilding the memo tag payload. Requires user confirmation.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"memoUid": {"type": "string", "description": "UID of the memo to tag. The canonical name form memos/{uid} is also accepted."},
				"addTags": {"type": "array", "items": {"type": "string"}, "description": "Tags to add, without '#'. Existing tags are left unchanged."},
				"removeTags": {"type": "array", "items": {"type": "string"}, "description": "Exact direct tags to remove from markdown content, without '#'."},
				"renameTags": {"type": "array", "items": {"type": "object", "properties": {"from": {"type": "string"}, "to": {"type": "string"}}, "required": ["from", "to"]}, "description": "Exact direct tags to rename."}
			},
			"required": ["memoUid"]
		}`,
	}
}

func (*TagMemoTool) RequiresConfirmation(_ string) bool {
	return true
}

func (*TagMemoTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args tagMemoArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid tag_memo arguments")
	}
	if len(args.AddTags) == 0 && len(args.RemoveTags) == 0 && len(args.RenameTags) == 0 {
		return "", errors.New("at least one tag operation is required")
	}
	memo, err := getMemoByUID(ctx, tc, args.MemoUID)
	if err != nil {
		return "", err
	}
	if err := currentUserCanModifyMemo(ctx, tc, memo); err != nil {
		return "", err
	}

	nextContent, addedTags, removedTags, renamedTags, changed, err := applyTagEdits(memo.Content, args.AddTags, args.RemoveTags, args.RenameTags)
	if err != nil {
		return "", err
	}
	if !changed {
		return marshalToolResult("No tag changes were needed:\n", tagMemoResult{
			MemoUID: memo.UID,
			Tags:    memoTags(memo),
			Changed: false,
		})
	}

	next := *memo
	next.Content = nextContent
	if err := rebuildMemoPayload(&next); err != nil {
		return "", err
	}
	if err := tc.Store.UpdateMemo(ctx, &store.UpdateMemo{
		ID:      memo.ID,
		Content: &next.Content,
		Payload: next.Payload,
	}); err != nil {
		return "", errors.Wrap(err, "failed to update memo tags")
	}
	updated, err := tc.Store.GetMemo(ctx, &store.FindMemo{ID: &memo.ID})
	if err != nil {
		return "", errors.Wrap(err, "failed to load updated memo")
	}
	return marshalToolResult(fmt.Sprintf("Updated tags for memo %s:\n", memo.UID), tagMemoResult{
		MemoUID:     memo.UID,
		AddedTags:   addedTags,
		RemovedTags: removedTags,
		RenamedTags: renamedTags,
		Tags:        memoTags(updated),
		Changed:     true,
	})
}
