package tools

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/store"
)

// UpdateMemoTool updates ordinary memo fields on behalf of the current user.
type UpdateMemoTool struct{}

type updateMemoArgs struct {
	MemoUID                string  `json:"memoUid"`
	Content                *string `json:"content"`
	Visibility             string  `json:"visibility"`
	Pinned                 *bool   `json:"pinned"`
	State                  string  `json:"state"`
	ScheduledTime          *int64  `json:"scheduledTime"`
	ClearScheduledTime     bool    `json:"clearScheduledTime"`
	ScheduledDuration      *int64  `json:"scheduledDuration"`
	ClearScheduledDuration bool    `json:"clearScheduledDuration"`
}

func (*UpdateMemoTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "update_memo",
		Description: "Update an existing memo's content, visibility, pinned flag, archive state, or schedule fields. Use get_memo first when changing content. Requires user confirmation.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"memoUid": {"type": "string", "description": "UID of the memo to update. The canonical name form memos/{uid} is also accepted."},
				"content": {"type": "string", "description": "Optional full replacement memo body in markdown. Do not pass a truncated snippet."},
				"visibility": {"type": "string", "enum": ["PUBLIC", "PROTECTED", "PRIVATE"], "description": "Optional visibility."},
				"pinned": {"type": "boolean", "description": "Optional pinned flag."},
				"state": {"type": "string", "enum": ["NORMAL", "ARCHIVED"], "description": "Optional archive state."},
				"scheduledTime": {"type": "integer", "description": "Optional Unix timestamp in seconds for the schedule start."},
				"clearScheduledTime": {"type": "boolean", "description": "Set true to clear scheduledTime."},
				"scheduledDuration": {"type": "integer", "description": "Optional scheduled duration in seconds. Must be positive."},
				"clearScheduledDuration": {"type": "boolean", "description": "Set true to clear scheduledDuration."}
			},
			"required": ["memoUid"]
		}`,
	}
}

func (*UpdateMemoTool) RequiresConfirmation(_ string) bool {
	return true
}

func (*UpdateMemoTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args updateMemoArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid update_memo arguments")
	}
	memo, err := getMemoByUID(ctx, tc, args.MemoUID)
	if err != nil {
		return "", err
	}
	if err := currentUserCanModifyMemo(ctx, tc, memo); err != nil {
		return "", err
	}

	update := &store.UpdateMemo{ID: memo.ID}
	changed := false
	if args.Content != nil {
		next := *memo
		next.Content = *args.Content
		if err := rebuildMemoPayload(&next); err != nil {
			return "", err
		}
		update.Content = &next.Content
		update.Payload = next.Payload
		changed = true
	}
	if visibility, err := parseVisibility(args.Visibility); err != nil {
		return "", err
	} else if visibility != nil {
		update.Visibility = visibility
		changed = true
	}
	if args.Pinned != nil {
		update.Pinned = args.Pinned
		changed = true
	}
	if state, err := parseRowStatus(args.State); err != nil {
		return "", err
	} else if state != nil {
		update.RowStatus = state
		changed = true
	}
	if args.ScheduledTime != nil {
		update.ScheduledTime = args.ScheduledTime
		changed = true
	}
	if args.ClearScheduledTime {
		update.ClearScheduledTime = true
		changed = true
	}
	if args.ScheduledDuration != nil {
		if *args.ScheduledDuration <= 0 {
			return "", errors.New("scheduledDuration must be positive")
		}
		update.ScheduledDuration = args.ScheduledDuration
		changed = true
	}
	if args.ClearScheduledDuration {
		update.ClearScheduledDuration = true
		changed = true
	}
	if !changed {
		return "", errors.New("no update fields were provided")
	}

	if err := tc.Store.UpdateMemo(ctx, update); err != nil {
		return "", errors.Wrap(err, "failed to update memo")
	}
	updated, err := tc.Store.GetMemo(ctx, &store.FindMemo{ID: &memo.ID})
	if err != nil {
		return "", errors.Wrap(err, "failed to load updated memo")
	}
	return marshalToolResult(fmt.Sprintf("Updated memo %s:\n", memo.UID), memoToToolMemo(updated, 500))
}
