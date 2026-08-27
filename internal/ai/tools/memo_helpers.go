package tools

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/markdown"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

const maxMemoToolBatchSize = 50

var memoMarkdownService = markdown.NewService(
	markdown.WithTagExtension(),
	markdown.WithMentionExtension(),
)

type toolMemo struct {
	UID               string   `json:"uid"`
	Content           string   `json:"content"`
	Visibility        string   `json:"visibility"`
	State             string   `json:"state"`
	Pinned            bool     `json:"pinned"`
	Tags              []string `json:"tags"`
	ParentUID         string   `json:"parentUid,omitempty"`
	CreatedTs         int64    `json:"createdTs"`
	UpdatedTs         int64    `json:"updatedTs"`
	ScheduledTime     *int64   `json:"scheduledTime,omitempty"`
	ScheduledDuration *int64   `json:"scheduledDuration,omitempty"`
}

type tagRename struct {
	From string `json:"from"`
	To   string `json:"to"`
}

func normalizeMemoUID(uid string) string {
	uid = strings.TrimSpace(uid)
	return strings.TrimPrefix(uid, "memos/")
}

func parseVisibility(value string) (*store.Visibility, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "":
		return nil, nil
	case "PUBLIC":
		visibility := store.Public
		return &visibility, nil
	case "PROTECTED":
		visibility := store.Protected
		return &visibility, nil
	case "PRIVATE":
		visibility := store.Private
		return &visibility, nil
	default:
		return nil, errors.Errorf("unsupported visibility %q", value)
	}
}

func parseRowStatus(value string) (*store.RowStatus, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "":
		return nil, nil
	case "NORMAL":
		state := store.Normal
		return &state, nil
	case "ARCHIVED":
		state := store.Archived
		return &state, nil
	case "ANY":
		return nil, nil
	default:
		return nil, errors.Errorf("unsupported state %q", value)
	}
}

func currentUserCanModifyMemo(ctx context.Context, tc ToolContext, memo *store.Memo) error {
	user, err := tc.Store.GetUser(ctx, &store.FindUser{ID: &tc.UserID})
	if err != nil {
		return errors.Wrap(err, "failed to load current user")
	}
	if memo.CreatorID != tc.UserID && (user == nil || user.Role != store.RoleAdmin) {
		return errors.New("permission denied: you can only modify memos you created")
	}
	return nil
}

func currentUserCanReadMemo(ctx context.Context, tc ToolContext, memo *store.Memo) error {
	user, err := tc.Store.GetUser(ctx, &store.FindUser{ID: &tc.UserID})
	if err != nil {
		return errors.Wrap(err, "failed to load current user")
	}
	if memo.CreatorID == tc.UserID || (user != nil && user.Role == store.RoleAdmin) {
		return nil
	}
	if memo.Visibility == store.Public || memo.Visibility == store.Protected {
		return nil
	}
	return errors.New("permission denied: memo is private")
}

func getMemoByUID(ctx context.Context, tc ToolContext, uid string) (*store.Memo, error) {
	uid = normalizeMemoUID(uid)
	if uid == "" {
		return nil, errors.New("memoUid is required")
	}
	memo, err := tc.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	if err != nil {
		return nil, errors.Wrap(err, "failed to get memo")
	}
	if memo == nil {
		return nil, errors.Errorf("memo %q not found", uid)
	}
	return memo, nil
}

func memoToToolMemo(memo *store.Memo, maxContentLength int) toolMemo {
	parentUID := ""
	if memo.ParentUID != nil {
		parentUID = *memo.ParentUID
	}
	content := memo.Content
	if maxContentLength > 0 {
		content = truncate(content, maxContentLength)
	}
	return toolMemo{
		UID:               memo.UID,
		Content:           content,
		Visibility:        memo.Visibility.String(),
		State:             memo.RowStatus.String(),
		Pinned:            memo.Pinned,
		Tags:              memoTags(memo),
		ParentUID:         parentUID,
		CreatedTs:         memo.CreatedTs,
		UpdatedTs:         memo.UpdatedTs,
		ScheduledTime:     memo.ScheduledTime,
		ScheduledDuration: memo.ScheduledDuration,
	}
}

func memoTags(memo *store.Memo) []string {
	if memo.Payload == nil || len(memo.Payload.Tags) == 0 {
		return []string{}
	}
	return append([]string(nil), memo.Payload.Tags...)
}

func rebuildMemoPayload(memo *store.Memo) error {
	if memo.Payload == nil {
		memo.Payload = &storepb.MemoPayload{}
	}
	data, err := memoMarkdownService.ExtractAll([]byte(memo.Content))
	if err != nil {
		return errors.Wrap(err, "failed to extract markdown metadata")
	}
	memo.Payload.Tags = data.Tags
	memo.Payload.Property = data.Property
	return nil
}

func marshalToolResult(prefix string, v any) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", errors.Wrap(err, "failed to marshal tool result")
	}
	if prefix == "" {
		return string(raw), nil
	}
	return prefix + string(raw), nil
}

func validateTag(tag string) (string, error) {
	tag = strings.TrimSpace(strings.TrimPrefix(tag, "#"))
	if tag == "" {
		return "", errors.New("tag cannot be empty")
	}
	if strings.ContainsAny(tag, " \t\r\n#") {
		return "", errors.Errorf("invalid tag %q", tag)
	}
	tags, err := memoMarkdownService.ExtractTags([]byte("#" + tag))
	if err != nil {
		return "", errors.Wrap(err, "failed to validate tag")
	}
	for _, got := range tags {
		if got == tag {
			return tag, nil
		}
	}
	return "", errors.Errorf("invalid tag %q", tag)
}

func validateTags(tags []string) ([]string, error) {
	out := make([]string, 0, len(tags))
	seen := make(map[string]bool, len(tags))
	for _, tag := range tags {
		normalized, err := validateTag(tag)
		if err != nil {
			return nil, err
		}
		if seen[normalized] {
			continue
		}
		seen[normalized] = true
		out = append(out, normalized)
	}
	return out, nil
}

func addTagsToContent(content string, existingTags []string, addTags []string) (string, []string, bool) {
	existing := make(map[string]bool, len(existingTags))
	for _, tag := range existingTags {
		existing[tag] = true
	}
	missing := make([]string, 0, len(addTags))
	for _, tag := range addTags {
		if existing[tag] {
			continue
		}
		existing[tag] = true
		missing = append(missing, tag)
	}
	if len(missing) == 0 {
		return content, missing, false
	}

	literals := make([]string, 0, len(missing))
	for _, tag := range missing {
		literals = append(literals, "#"+tag)
	}
	content = strings.TrimRight(content, " \t\r\n")
	if content == "" {
		return strings.Join(literals, " "), missing, true
	}
	return content + "\n\n" + strings.Join(literals, " "), missing, true
}

func applyTagEdits(content string, addTags []string, removeTags []string, renameTags []tagRename) (string, []string, []string, []tagRename, bool, error) {
	currentContent := content
	appliedRenames := make([]tagRename, 0, len(renameTags))
	for _, rename := range renameTags {
		from, err := validateTag(rename.From)
		if err != nil {
			return "", nil, nil, nil, false, err
		}
		to, err := validateTag(rename.To)
		if err != nil {
			return "", nil, nil, nil, false, err
		}
		nextContent, err := memoMarkdownService.RenameTag([]byte(currentContent), from, to)
		if err != nil {
			return "", nil, nil, nil, false, errors.Wrap(err, "failed to rename tag")
		}
		if nextContent != currentContent {
			appliedRenames = append(appliedRenames, tagRename{From: from, To: to})
			currentContent = nextContent
		}
	}

	validRemoveTags, err := validateTags(removeTags)
	if err != nil {
		return "", nil, nil, nil, false, err
	}
	removedTags := []string{}
	if len(validRemoveTags) > 0 {
		nextContent, err := memoMarkdownService.RemoveTags([]byte(currentContent), validRemoveTags)
		if err != nil {
			return "", nil, nil, nil, false, errors.Wrap(err, "failed to remove tags")
		}
		if nextContent != currentContent {
			removedTags = validRemoveTags
			currentContent = nextContent
		}
	}

	memo := &store.Memo{Content: currentContent}
	if err := rebuildMemoPayload(memo); err != nil {
		return "", nil, nil, nil, false, err
	}
	validAddTags, err := validateTags(addTags)
	if err != nil {
		return "", nil, nil, nil, false, err
	}
	nextContent, addedTags, added := addTagsToContent(currentContent, memoTags(memo), validAddTags)
	if added {
		currentContent = nextContent
	}

	return currentContent, addedTags, removedTags, appliedRenames, currentContent != content, nil
}
