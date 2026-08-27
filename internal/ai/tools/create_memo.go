package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	shortuuid "github.com/lithammer/shortuuid/v4"
	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/store"
)

// CreateMemoTool lets the assistant create a new memo on behalf of the user.
type CreateMemoTool struct{}

type createMemoArgs struct {
	Content    string `json:"content"`
	Visibility string `json:"visibility"`
	ParentUID  string `json:"parentUid"`
}

func (*CreateMemoTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "create_memo",
		Description: "Create a new memo for the current user with the given content and optional visibility (PUBLIC, PROTECTED, PRIVATE). Optionally attach it as a comment to another memo via parentUid.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"content": {"type": "string", "description": "The memo body in plain text or markdown."},
				"visibility": {"type": "string", "enum": ["PUBLIC", "PROTECTED", "PRIVATE"], "description": "Visibility of the new memo. Defaults to PRIVATE."},
				"parentUid": {"type": "string", "description": "Optional UID of a memo to attach this memo to as a comment."}
			},
			"required": ["content"]
		}`,
	}
}

func (*CreateMemoTool) RequiresConfirmation(_ string) bool {
	return true
}

func (*CreateMemoTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args createMemoArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid create_memo arguments")
	}
	if strings.TrimSpace(args.Content) == "" {
		return "", errors.New("content is required")
	}
	visibility := store.Private
	if v := strings.TrimSpace(args.Visibility); v != "" {
		visibility = store.Visibility(v)
	}

	create := &store.Memo{
		UID:        shortuuid.New(),
		CreatorID:  tc.UserID,
		Content:    args.Content,
		Visibility: visibility,
	}
	if parentUID := strings.TrimSpace(args.ParentUID); parentUID != "" {
		parentUIDCopy := parentUID
		create.ParentUID = &parentUIDCopy
	}

	memo, err := tc.Store.CreateMemo(ctx, create)
	if err != nil {
		return "", errors.Wrap(err, "failed to create memo")
	}
	return fmt.Sprintf("Created memo %s (visibility %s).", memo.UID, memo.Visibility.String()), nil
}
