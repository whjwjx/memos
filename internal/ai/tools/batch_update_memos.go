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

// BatchUpdateMemosTool applies the same safe memo operations to explicit UIDs.
type BatchUpdateMemosTool struct{}

type batchUpdateMemosArgs struct {
	MemoUIDs   []string    `json:"memoUids"`
	AddTags    []string    `json:"addTags"`
	RemoveTags []string    `json:"removeTags"`
	RenameTags []tagRename `json:"renameTags"`
	Pinned     *bool       `json:"pinned"`
	Visibility string      `json:"visibility"`
	State      string      `json:"state"`
}

type batchUpdateMemoResult struct {
	MemoUID     string      `json:"memoUid"`
	Changed     bool        `json:"changed"`
	AddedTags   []string    `json:"addedTags,omitempty"`
	RemovedTags []string    `json:"removedTags,omitempty"`
	RenamedTags []tagRename `json:"renamedTags,omitempty"`
	Tags        []string    `json:"tags,omitempty"`
	Pinned      *bool       `json:"pinned,omitempty"`
	Visibility  string      `json:"visibility,omitempty"`
	State       string      `json:"state,omitempty"`
}

func (*BatchUpdateMemosTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "batch_update_memos",
		Description: "Apply the same tag, pinned, visibility, or archive-state changes to an explicit list of memo UIDs. Use search_memos first to show the user the candidate list, then call this tool only with the confirmed memoUids. Requires user confirmation.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"memoUids": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 50, "description": "Explicit memo UIDs to update. The canonical name form memos/{uid} is also accepted."},
				"addTags": {"type": "array", "items": {"type": "string"}, "description": "Tags to add to every memo, without '#'. Existing tags are no-ops."},
				"removeTags": {"type": "array", "items": {"type": "string"}, "description": "Exact direct tags to remove from every memo, without '#'."},
				"renameTags": {"type": "array", "items": {"type": "object", "properties": {"from": {"type": "string"}, "to": {"type": "string"}}, "required": ["from", "to"]}, "description": "Exact direct tags to rename on every memo."},
				"pinned": {"type": "boolean", "description": "Optional pinned flag to set on every memo."},
				"visibility": {"type": "string", "enum": ["PUBLIC", "PROTECTED", "PRIVATE"], "description": "Optional visibility to set on every memo."},
				"state": {"type": "string", "enum": ["NORMAL", "ARCHIVED"], "description": "Optional archive state to set on every memo."}
			},
			"required": ["memoUids"]
		}`,
	}
}

func (*BatchUpdateMemosTool) RequiresConfirmation(_ string) bool {
	return true
}

func (*BatchUpdateMemosTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args batchUpdateMemosArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid batch_update_memos arguments")
	}
	uids := uniqueMemoUIDs(args.MemoUIDs)
	if len(uids) == 0 {
		return "", errors.New("memoUids is required")
	}
	if len(uids) > maxMemoToolBatchSize {
		return "", errors.Errorf("too many memos: maximum is %d", maxMemoToolBatchSize)
	}
	if args.Pinned == nil && len(args.AddTags) == 0 && len(args.RemoveTags) == 0 && len(args.RenameTags) == 0 && args.Visibility == "" && args.State == "" {
		return "", errors.New("at least one batch update operation is required")
	}

	visibility, err := parseVisibility(args.Visibility)
	if err != nil {
		return "", err
	}
	state, err := parseRowStatus(args.State)
	if err != nil {
		return "", err
	}
	if strings.EqualFold(args.State, "ANY") {
		return "", errors.New("state ANY is only supported by search_memos")
	}
	if _, _, _, _, _, err := applyTagEdits("", args.AddTags, args.RemoveTags, args.RenameTags); err != nil {
		return "", err
	}

	memos := make([]*store.Memo, 0, len(uids))
	for _, uid := range uids {
		memo, err := getMemoByUID(ctx, tc, uid)
		if err != nil {
			return "", err
		}
		if err := currentUserCanModifyMemo(ctx, tc, memo); err != nil {
			return "", errors.Wrapf(err, "memo %s", uid)
		}
		memos = append(memos, memo)
	}

	results := make([]batchUpdateMemoResult, 0, len(memos))
	for _, memo := range memos {
		result, err := runBatchMemoUpdate(ctx, tc, memo, args, visibility, state)
		if err != nil {
			return "", err
		}
		results = append(results, result)
	}
	return marshalToolResult(fmt.Sprintf("Batch updated %d memo(s):\n", len(results)), results)
}

func uniqueMemoUIDs(rawUIDs []string) []string {
	out := make([]string, 0, len(rawUIDs))
	seen := make(map[string]bool, len(rawUIDs))
	for _, rawUID := range rawUIDs {
		uid := normalizeMemoUID(rawUID)
		if uid == "" || seen[uid] {
			continue
		}
		seen[uid] = true
		out = append(out, uid)
	}
	return out
}

func runBatchMemoUpdate(ctx context.Context, tc ToolContext, memo *store.Memo, args batchUpdateMemosArgs, visibility *store.Visibility, state *store.RowStatus) (batchUpdateMemoResult, error) {
	update := &store.UpdateMemo{ID: memo.ID}
	changed := false
	result := batchUpdateMemoResult{MemoUID: memo.UID}

	if len(args.AddTags) > 0 || len(args.RemoveTags) > 0 || len(args.RenameTags) > 0 {
		nextContent, addedTags, removedTags, renamedTags, tagChanged, err := applyTagEdits(memo.Content, args.AddTags, args.RemoveTags, args.RenameTags)
		if err != nil {
			return result, err
		}
		if tagChanged {
			next := *memo
			next.Content = nextContent
			if err := rebuildMemoPayload(&next); err != nil {
				return result, err
			}
			update.Content = &next.Content
			update.Payload = next.Payload
			result.AddedTags = addedTags
			result.RemovedTags = removedTags
			result.RenamedTags = renamedTags
			result.Tags = memoTags(&next)
			changed = true
		}
	}
	if args.Pinned != nil && memo.Pinned != *args.Pinned {
		update.Pinned = args.Pinned
		result.Pinned = args.Pinned
		changed = true
	}
	if visibility != nil && memo.Visibility != *visibility {
		update.Visibility = visibility
		result.Visibility = visibility.String()
		changed = true
	}
	if state != nil && memo.RowStatus != *state {
		update.RowStatus = state
		result.State = state.String()
		changed = true
	}
	if changed {
		if err := tc.Store.UpdateMemo(ctx, update); err != nil {
			return result, errors.Wrapf(err, "failed to update memo %s", memo.UID)
		}
	}
	result.Changed = changed
	return result, nil
}
