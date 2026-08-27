package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai/chat"
)

// GetMemoTool reads one memo in full before the assistant edits or summarizes it.
type GetMemoTool struct{}

type getMemoArgs struct {
	MemoUID string `json:"memoUid"`
}

func (*GetMemoTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "get_memo",
		Description: "Get the full content and metadata for one memo identified by memoUid. Use this before editing a memo so you do not rely on a truncated search result.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"memoUid": {"type": "string", "description": "UID of the memo to read. The canonical name form memos/{uid} is also accepted."}
			},
			"required": ["memoUid"]
		}`,
	}
}

func (*GetMemoTool) RequiresConfirmation(_ string) bool {
	return false
}

func (*GetMemoTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args getMemoArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid get_memo arguments")
	}
	memo, err := getMemoByUID(ctx, tc, args.MemoUID)
	if err != nil {
		return "", err
	}
	if err := currentUserCanReadMemo(ctx, tc, memo); err != nil {
		return "", err
	}
	return marshalToolResult(fmt.Sprintf("Memo %s:\n", memo.UID), memoToToolMemo(memo, 0))
}
