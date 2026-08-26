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

// SearchMemosTool lets the assistant find the user's memos by keyword or tag.
type SearchMemosTool struct{}

type searchMemosArgs struct {
	Query           string `json:"query"`
	Limit           int    `json:"limit"`
	Visibility      string `json:"visibility"`
	IncludeComments bool   `json:"includeComments"`
}

type searchMemosMemo struct {
	UID        string `json:"uid"`
	Content    string `json:"content"`
	Visibility string `json:"visibility"`
	ParentUID  string `json:"parentUid"`
	CreatedTs  int64  `json:"createdTs"`
	UpdatedTs  int64  `json:"updatedTs"`
}

func (*SearchMemosTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "search_memos",
		Description: "Search the current user's memos by keyword or tag. Returns a list of matching memos with their UID, content snippet, visibility, timestamps and parentUid. A non-empty parentUid means the memo is a comment attached to another memo; an empty parentUid means it is a standalone memo. Comments are excluded by default.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"query": {"type": "string", "description": "Free-text keyword matched against memo content. When the user has not specified a keyword (for example after approving a tool and only saying 'continue'), pass an empty string \"\" to list the user's most recent memos instead of guessing a keyword."},
				"limit": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Maximum number of memos to return. Must be an integer between 1 and 50. Defaults to 10. Do NOT pass boolean values like true/false."},
				"visibility": {"type": "string", "enum": ["PUBLIC", "PROTECTED", "PRIVATE"], "description": "Optional visibility filter."},
				"includeComments": {"type": "boolean", "description": "Set to true to also include comments (memos with a parentUid). Defaults to false so only standalone memos are returned."}
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
	if v := strings.TrimSpace(args.Visibility); v != "" {
		vis := store.Visibility(v)
		find.VisibilityList = []store.Visibility{vis}
	}
	// An empty query lists the user's most recent memos (no keyword filter).
	// Otherwise translate the free-text query into a CEL content.contains()
	// filter so the existing pipeline does a substring search instead of
	// treating the raw query as a CEL expression.
	if q := strings.TrimSpace(args.Query); q != "" {
		escaped := strings.ReplaceAll(q, `"`, `\"`)
		find.Filters = []string{`content.contains("` + escaped + `")`}
	}

	memos, err := tc.Store.ListMemos(ctx, find)
	if err != nil {
		return "", errors.Wrap(err, "failed to list memos")
	}
	if len(memos) == 0 {
		return "No matching memos found.", nil
	}

	out := make([]searchMemosMemo, 0, len(memos))
	for _, m := range memos {
		parentUID := ""
		if m.ParentUID != nil {
			parentUID = *m.ParentUID
		}
		out = append(out, searchMemosMemo{
			UID:        m.UID,
			Content:    truncate(m.Content, 500),
			Visibility: m.Visibility.String(),
			ParentUID:  parentUID,
			CreatedTs:  m.CreatedTs,
			UpdatedTs:  m.UpdatedTs,
		})
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return "", errors.Wrap(err, "failed to marshal search results")
	}
	return fmt.Sprintf("Found %d memo(s):\n%s", len(out), string(raw)), nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
