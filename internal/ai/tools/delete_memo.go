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

// DeleteMemoTool lets the assistant remove a memo by UID on behalf of the user.
// Deletion is destructive, so the tool is gated behind confirmation.
type DeleteMemoTool struct{}

type deleteMemoArgs struct {
	MemoUID string `json:"memoUid"`
}

func (*DeleteMemoTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "delete_memo",
		Description: "Permanently delete a memo (or a comment) identified by its memoUid. This cannot be undone. Use search_memos or get_comments first to obtain the UID. Deletion is a destructive action and requires user confirmation.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"memoUid": {"type": "string", "description": "UID of the memo (or comment) to delete."}
			},
			"required": ["memoUid"]
		}`,
	}
}

func (*DeleteMemoTool) RequiresConfirmation(_ string) bool {
	return true
}

func (*DeleteMemoTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args deleteMemoArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid delete_memo arguments")
	}
	uid := strings.TrimSpace(args.MemoUID)
	if uid == "" {
		return "", errors.New("memoUid is required")
	}

	memo, err := tc.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	if err != nil {
		return "", errors.Wrap(err, "failed to get memo")
	}
	if memo == nil {
		return "", errors.Errorf("memo %q not found", uid)
	}

	// Mirror the API-layer DeleteMemo permission model: the creator or an admin
	// may delete the memo.
	user, err := tc.Store.GetUser(ctx, &store.FindUser{ID: &tc.UserID})
	if err != nil {
		return "", errors.Wrap(err, "failed to load current user")
	}
	if memo.CreatorID != tc.UserID && (user == nil || user.Role != store.RoleAdmin) {
		return "", errors.Errorf("permission denied: you can only delete memos you created")
	}

	if err := tc.Store.DeleteMemo(ctx, &store.DeleteMemo{ID: memo.ID}); err != nil {
		return "", errors.Wrap(err, "failed to delete memo")
	}
	return fmt.Sprintf("Deleted memo %s.", uid), nil
}
