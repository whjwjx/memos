package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	shortuuid "github.com/lithammer/shortuuid/v4"
	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai/chat"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// maxMemoryEntries caps how many entries the shared memory bank may hold. The
// bank is stored inline in the AI instance setting, so it must stay small.
const maxMemoryEntries = 100

// maxMemoryContentLength caps a single memory entry's content so the injected
// context cannot grow unbounded.
const maxMemoryContentLength = 4096

// ManageMemoryTool lets the assistant read and maintain the instance-wide shared
// memory bank. It is admin only: the memory is injected into every user's chat
// context, so any user could pollute it.
type ManageMemoryTool struct{}

type manageMemoryArgs struct {
	// Operation is one of list, add, update, delete.
	Operation string `json:"operation"`
	// ID is the entry id, required for update and delete.
	ID string `json:"id"`
	// Content is the memory text, required for add and update.
	Content string `json:"content"`
}

func (*ManageMemoryTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "manage_memory",
		Description: "Read or maintain the instance-wide shared memory: a small bank of context facts injected into every chat conversation. Use list to read the current entries, add to store a new fact, update to replace an entry's text, and delete to remove an entry. This memory is visible in all users' conversations, so only store safe, generally useful facts. ADMIN ONLY.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"operation": {"type": "string", "enum": ["list", "add", "update", "delete"], "description": "list reads all entries; add stores a new fact; update replaces the entry with the given id; delete removes the entry with the given id."},
				"id": {"type": "string", "description": "Entry id as shown by list. Required for update and delete."},
				"content": {"type": "string", "description": "Memory text. Required for add and update. Keep it short and generally useful."}
			},
			"required": ["operation"]
		}`,
	}
}

func (*ManageMemoryTool) RequiresConfirmation(argsJSON string) bool {
	var args manageMemoryArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return false
	}
	switch args.Operation {
	case "add", "update", "delete":
		return true
	}
	return false
}

func (t *ManageMemoryTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args manageMemoryArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid manage_memory arguments")
	}
	if tc.Store == nil {
		return "", errors.New("store not available")
	}
	if args.Operation == "" {
		return "", errors.New("operation is required (list, add, update or delete)")
	}

	// manage_memory is admin-only: the memory bank is shared into every chat.
	user, err := tc.Store.GetUser(ctx, &store.FindUser{ID: &tc.UserID})
	if err != nil {
		return "", errors.Wrap(err, "failed to load current user")
	}
	if user == nil || user.Role != store.RoleAdmin {
		return "", errors.New("permission denied: manage_memory requires an admin account")
	}

	setting, err := tc.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return "", errors.Wrap(err, "failed to load AI setting")
	}
	memory := setting.GetMemory()
	if memory == nil {
		memory = &storepb.MemoryConfig{}
	}
	entries := memory.GetEntries()

	switch args.Operation {
	case "list":
		if len(entries) == 0 {
			return "(memory is empty)", nil
		}
		var b strings.Builder
		for i, e := range entries {
			fmt.Fprintf(&b, "%d. [%s] %s\n", i+1, e.Id, e.Content)
		}
		return b.String(), nil
	case "add":
		content := strings.TrimSpace(args.Content)
		if content == "" {
			return "", errors.New("content is required for add")
		}
		if len(content) > maxMemoryContentLength {
			return "", errors.Errorf("memory content is too long (max %d chars)", maxMemoryContentLength)
		}
		if len(entries) >= maxMemoryEntries {
			return "", errors.Errorf("memory is full (max %d entries): delete some entries first", maxMemoryEntries)
		}
		now := time.Now().Unix()
		entries = append(entries, &storepb.MemoryEntry{
			Id:        shortuuid.New(),
			Content:   content,
			CreatedBy: user.Username,
			CreatedTs: now,
			UpdatedTs: now,
		})
	case "update":
		if args.ID == "" {
			return "", errors.New("id is required for update")
		}
		content := strings.TrimSpace(args.Content)
		if content == "" {
			return "", errors.New("content is required for update")
		}
		found := false
		for _, e := range entries {
			if e.Id == args.ID {
				e.Content = content
				e.UpdatedTs = time.Now().Unix()
				found = true
				break
			}
		}
		if !found {
			return "", errors.Errorf("memory entry %q not found", args.ID)
		}
	case "delete":
		if args.ID == "" {
			return "", errors.New("id is required for delete")
		}
		next := entries[:0]
		found := false
		for _, e := range entries {
			if e.Id == args.ID {
				found = true
				continue
			}
			next = append(next, e)
		}
		if !found {
			return "", errors.Errorf("memory entry %q not found", args.ID)
		}
		entries = next
	default:
		return "", errors.Errorf("unknown operation %q", args.Operation)
	}

	memory.Entries = entries
	setting.Memory = memory
	if _, err := tc.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: setting},
	}); err != nil {
		return "", errors.Wrap(err, "failed to save memory")
	}

	switch args.Operation {
	case "add":
		return fmt.Sprintf("added memory entry: %s", entries[len(entries)-1].Content), nil
	case "update":
		return "updated memory entry", nil
	case "delete":
		return "deleted memory entry", nil
	}
	return "", errors.Errorf("unknown operation %q", args.Operation)
}
