package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/store"
)

// AutoTagTool enqueues automatic tagging for a memo. The background tag worker
// reads the configured taggers, classifies the memo, and applies the tags.
// Because it mutates the memo's tags, it requires confirmation.
type AutoTagTool struct{}

type autoTagArgs struct {
	MemoUID string `json:"memoUid"`
	Force   bool   `json:"force"`
}

func (*AutoTagTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "auto_tag",
		Description: "Request automatic tagging for a memo identified by memoUid. The tag worker applies the configured taggers' labels. Set force to true to re-tag after manual edits. Requires user confirmation.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"memoUid": {"type": "string", "description": "UID of the memo to tag."},
				"force": {"type": "boolean", "description": "Re-run tagging even if already tagged. Defaults to false."}
			},
			"required": ["memoUid"]
		}`,
	}
}

func (*AutoTagTool) RequiresConfirmation(_ string) bool {
	return true
}

func (*AutoTagTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args autoTagArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid auto_tag arguments")
	}
	if strings.TrimSpace(args.MemoUID) == "" {
		return "", errors.New("memoUid is required")
	}
	memo, err := tc.Store.GetMemo(ctx, &store.FindMemo{UID: &args.MemoUID})
	if err != nil {
		return "", errors.Wrap(err, "failed to get memo")
	}
	if memo == nil {
		return "", errors.Errorf("memo %q not found", args.MemoUID)
	}

	nowSec := time.Now().Unix()
	if _, err := tc.Store.UpsertMemoTagTask(ctx, &store.CreateMemoTagTask{
		MemoID: memo.ID,
		DueAt:  nowSec,
		Force:  args.Force,
	}); err != nil {
		return "", errors.Wrap(err, "failed to enqueue tagging task")
	}
	return fmt.Sprintf("Queued automatic tagging for memo %s.", args.MemoUID), nil
}
