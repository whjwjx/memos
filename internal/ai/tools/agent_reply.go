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

// AgentReplyTool enqueues an automatic agent reply for a memo. The background
// agent worker picks up the task and posts the reply as a comment. Because it
// triggers content generation on the user's behalf, it requires confirmation.
type AgentReplyTool struct{}

type agentReplyArgs struct {
	MemoUID string `json:"memoUid"`
}

func (*AgentReplyTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "agent_reply",
		Description: "Request the configured automatic-comment agents to reply to a memo identified by memoUid. The reply is posted as a comment by an admin account. Requires user confirmation.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"memoUid": {"type": "string", "description": "UID of the memo to request agent replies for."}
			},
			"required": ["memoUid"]
		}`,
	}
}

func (*AgentReplyTool) RequiresConfirmation(_ string) bool {
	return true
}

func (*AgentReplyTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args agentReplyArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid agent_reply arguments")
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
	if _, err := tc.Store.UpsertAgentReplyTask(ctx, &store.CreateAgentReplyTask{
		MemoID: memo.ID,
		DueAt:  nowSec,
	}); err != nil {
		return "", errors.Wrap(err, "failed to enqueue agent reply")
	}
	return fmt.Sprintf("Queued an agent reply for memo %s. It will be posted shortly.", args.MemoUID), nil
}
