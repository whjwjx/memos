package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/store"
)

// GetCommentsTool lists the comments on a memo the user can see.
type GetCommentsTool struct{}

type getCommentsArgs struct {
	MemoUID string `json:"memoUid"`
	Limit   int    `json:"limit"`
}

type getCommentsComment struct {
	UID       string `json:"uid"`
	Content   string `json:"content"`
	CreatorID int32  `json:"creatorId"`
	CreatedTs int64  `json:"createdTs"`
}

func (*GetCommentsTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "get_comments",
		Description: "List the comments attached to a memo identified by memoUid. Returns each comment's UID, content, author and creation time. Private comments written by other users are omitted.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"memoUid": {"type": "string", "description": "UID of the memo whose comments to fetch."},
				"limit": {"type": "integer", "description": "Maximum number of comments to return (1-50). Defaults to 20."}
			},
			"required": ["memoUid"]
		}`,
	}
}

func (*GetCommentsTool) RequiresConfirmation(_ string) bool {
	return false
}

func (*GetCommentsTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args getCommentsArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid get_comments arguments")
	}
	if strings.TrimSpace(args.MemoUID) == "" {
		return "", errors.New("memoUid is required")
	}
	limit := args.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}

	parent, err := tc.Store.GetMemo(ctx, &store.FindMemo{UID: &args.MemoUID})
	if err != nil {
		return "", errors.Wrap(err, "failed to get memo")
	}
	if parent == nil {
		return "", errors.Errorf("memo %q not found", args.MemoUID)
	}

	commentType := store.MemoRelationComment
	relations, err := tc.Store.ListMemoRelations(ctx, &store.FindMemoRelation{
		RelatedMemoID: &parent.ID,
		Type:          &commentType,
		Limit:         &limit,
	})
	if err != nil {
		return "", errors.Wrap(err, "failed to list comments")
	}
	if len(relations) == 0 {
		return "No comments found on this memo.", nil
	}

	out := make([]getCommentsComment, 0, len(relations))
	for _, rel := range relations {
		commentMemo, err := tc.Store.GetMemo(ctx, &store.FindMemo{ID: &rel.MemoID})
		if err != nil {
			return "", errors.Wrap(err, "failed to load comment memo")
		}
		if commentMemo == nil {
			continue
		}
		// Visibility filter: hide private comments authored by other users.
		if commentMemo.Visibility == store.Private && commentMemo.CreatorID != tc.UserID {
			continue
		}
		out = append(out, getCommentsComment{
			UID:       commentMemo.UID,
			Content:   truncate(commentMemo.Content, 500),
			CreatorID: commentMemo.CreatorID,
			CreatedTs: commentMemo.CreatedTs,
		})
	}
	if len(out) == 0 {
		return "No visible comments found on this memo.", nil
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return "", errors.Wrap(err, "failed to marshal comments")
	}
	return fmt.Sprintf("Found %d comment(s):\n%s", len(out), string(raw)), nil
}
