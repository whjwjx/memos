package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/store"
)

// SearchMemosTool lets the assistant find the user's memos by keyword or tag.
type SearchMemosTool struct{}

type searchMemosArgs struct {
	Query           string   `json:"query"`
	Limit           int      `json:"limit"`
	Visibility      string   `json:"visibility"`
	IncludeComments bool     `json:"includeComments"`
	Pinned          *bool    `json:"pinned"`
	State           string   `json:"state"`
	Tags            []string `json:"tags"`
	TagMode         string   `json:"tagMode"`
	OrderBy         string   `json:"orderBy"`
}

func (*SearchMemosTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "search_memos",
		Description: "Search the current user's memos by keyword, tag, pin state, visibility, archive state, and ordering. Returns memo UID, content snippet, tags, pinned flag, state, visibility, timestamps and parentUid. A non-empty parentUid means the memo is a comment attached to another memo; an empty parentUid means it is a standalone memo. Comments are excluded by default.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"query": {"type": "string", "description": "Free-text keyword matched against memo content. When the user has not specified a keyword (for example after approving a tool and only saying 'continue'), pass an empty string \"\" to list the user's most recent memos instead of guessing a keyword."},
				"limit": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Maximum number of memos to return. Must be an integer between 1 and 50. Defaults to 10. Do NOT pass boolean values like true/false."},
				"visibility": {"type": "string", "enum": ["PUBLIC", "PROTECTED", "PRIVATE"], "description": "Optional visibility filter."},
				"includeComments": {"type": "boolean", "description": "Set to true to also include comments (memos with a parentUid). Defaults to false so only standalone memos are returned."},
				"pinned": {"type": "boolean", "description": "Optional pinned filter. true returns pinned memos; false returns unpinned memos."},
				"state": {"type": "string", "enum": ["NORMAL", "ARCHIVED", "ANY"], "description": "Memo state filter. Defaults to NORMAL. Use ARCHIVED for archived memos or ANY to include every state."},
				"tags": {"type": "array", "items": {"type": "string"}, "description": "Optional exact tag filters without '#'. Hierarchical parent tags are matched using the memo payload's expanded tags."},
				"tagMode": {"type": "string", "enum": ["any", "all"], "description": "How to match tags. Defaults to any."},
				"orderBy": {"type": "string", "enum": ["create_time_desc", "create_time_asc", "update_time_desc", "update_time_asc", "pinned_create_time_desc", "pinned_update_time_desc"], "description": "Optional result ordering. Defaults to create_time_desc."}
			},
			"required": []
		}`,
	}
}

func (*SearchMemosTool) RequiresConfirmation(_ string) bool {
	return false
}

func (*SearchMemosTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args searchMemosArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid search_memos arguments")
	}
	limit := args.Limit
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}

	find := &store.FindMemo{
		CreatorID:       &tc.UserID,
		Limit:           &limit,
		ExcludeComments: !args.IncludeComments,
	}
	if state, err := parseRowStatus(args.State); err != nil {
		return "", err
	} else if strings.ToUpper(strings.TrimSpace(args.State)) != "ANY" {
		if state == nil {
			normal := store.Normal
			find.RowStatus = &normal
		} else {
			find.RowStatus = state
		}
	}
	if visibility, err := parseVisibility(args.Visibility); err != nil {
		return "", err
	} else if visibility != nil {
		find.VisibilityList = []store.Visibility{*visibility}
	}
	// An empty query lists the user's most recent memos (no keyword filter).
	// Otherwise translate the free-text query into a CEL content.contains()
	// filter so the existing pipeline does a substring search instead of
	// treating the raw query as a CEL expression.
	if q := strings.TrimSpace(args.Query); q != "" {
		find.Filters = append(find.Filters, `content.contains(`+strconv.Quote(q)+`)`)
	}
	if args.Pinned != nil {
		find.Filters = append(find.Filters, fmt.Sprintf("pinned == %t", *args.Pinned))
	}
	if len(args.Tags) > 0 {
		tags, err := validateTags(args.Tags)
		if err != nil {
			return "", err
		}
		tagLiterals := make([]string, 0, len(tags))
		for _, tag := range tags {
			tagLiterals = append(tagLiterals, strconv.Quote(tag))
		}
		switch strings.ToLower(strings.TrimSpace(args.TagMode)) {
		case "", "any":
			find.Filters = append(find.Filters, "sets.intersects(tags, ["+strings.Join(tagLiterals, ", ")+"])")
		case "all":
			find.Filters = append(find.Filters, "sets.contains(tags, ["+strings.Join(tagLiterals, ", ")+"])")
		default:
			return "", errors.Errorf("unsupported tagMode %q", args.TagMode)
		}
	}
	if err := applyMemoSearchOrder(args.OrderBy, find); err != nil {
		return "", err
	}

	memos, err := tc.Store.ListMemos(ctx, find)
	if err != nil {
		return "", errors.Wrap(err, "failed to list memos")
	}
	if len(memos) == 0 {
		return "No matching memos found.", nil
	}

	out := make([]toolMemo, 0, len(memos))
	for _, m := range memos {
		out = append(out, memoToToolMemo(m, 500))
	}
	return marshalToolResult(fmt.Sprintf("Found %d memo(s):\n", len(out)), out)
}

func applyMemoSearchOrder(orderBy string, find *store.FindMemo) error {
	switch strings.ToLower(strings.TrimSpace(orderBy)) {
	case "", "create_time_desc":
		find.OrderByTimeAsc = false
	case "create_time_asc":
		find.OrderByTimeAsc = true
	case "update_time_desc":
		find.OrderByUpdatedTs = true
		find.OrderByTimeAsc = false
	case "update_time_asc":
		find.OrderByUpdatedTs = true
		find.OrderByTimeAsc = true
	case "pinned_create_time_desc":
		find.OrderByPinned = true
		find.OrderByTimeAsc = false
	case "pinned_update_time_desc":
		find.OrderByPinned = true
		find.OrderByUpdatedTs = true
		find.OrderByTimeAsc = false
	default:
		return errors.Errorf("unsupported orderBy %q", orderBy)
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
