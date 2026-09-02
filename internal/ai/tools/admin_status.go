package tools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai/chat"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

const (
	queryQueueAgentReply = "agent_reply_task"
	queryQueueMemoTag    = "memo_tag_task"
	defaultQueueRows     = 10
	maxQueueRows         = 50
)

var queryQueueStatusValues = map[string]bool{
	string(store.AgentReplyTaskPending): true,
	string(store.AgentReplyTaskDone):    true,
	string(store.AgentReplyTaskFailed):  true,
}

// QueryQueueTool gives admins a read-only view of AI background queues.
type QueryQueueTool struct{}

type queryQueueArgs struct {
	Queue   string `json:"queue"`
	Status  string `json:"status"`
	MemoUID string `json:"memoUid"`
	MemoID  int32  `json:"memoId"`
	Limit   int    `json:"limit"`
}

type queryQueueResult struct {
	GeneratedAt int64          `json:"generatedAt"`
	Queues      []queueSummary `json:"queues"`
}

type queueSummary struct {
	Name   string           `json:"name"`
	Counts map[string]int64 `json:"counts"`
	Tasks  []queueTask      `json:"tasks"`
}

type queueTask struct {
	ID        int32  `json:"id"`
	MemoID    int32  `json:"memoId"`
	AgentID   string `json:"agentId,omitempty"`
	TaggerID  string `json:"taggerId,omitempty"`
	Status    string `json:"status"`
	DueAt     int64  `json:"dueAt"`
	CreatedTs int64  `json:"createdTs"`
	UpdatedTs int64  `json:"updatedTs"`
}

func (*QueryQueueTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "query_queue",
		Description: "Inspect AI queue health and recent tasks for agent replies and memo auto-tagging. Supports filtering by queue, status, memoUid or memoId. Read-only and ADMIN ONLY.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"queue": {"type": "string", "enum": ["agent_reply_task", "memo_tag_task"], "description": "Optional queue to inspect. Omit to inspect both queues."},
				"status": {"type": "string", "enum": ["PENDING", "DONE", "FAILED"], "description": "Optional task status filter."},
				"memoUid": {"type": "string", "description": "Optional memo uid, also accepts memos/{uid}."},
				"memoId": {"type": "integer", "description": "Optional numeric memo id."},
				"limit": {"type": "integer", "description": "Maximum recent tasks per queue (1-50, default 10)."}
			}
		}`,
	}
}

func (*QueryQueueTool) RequiresConfirmation(_ string) bool {
	return false
}

func (*QueryQueueTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args queryQueueArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid query_queue arguments")
	}
	if err := requireAdminTool(ctx, tc, "query_queue"); err != nil {
		return "", err
	}
	queue, err := normalizeQueueName(args.Queue)
	if err != nil {
		return "", err
	}
	status, err := normalizeQueueStatus(args.Status)
	if err != nil {
		return "", err
	}
	memoID, err := resolveQueueMemoID(ctx, tc, args.MemoUID, args.MemoID)
	if err != nil {
		return "", err
	}
	limit := normalizeQueueLimit(args.Limit)

	queues := []string{queryQueueAgentReply, queryQueueMemoTag}
	if queue != "" {
		queues = []string{queue}
	}
	result := queryQueueResult{
		GeneratedAt: time.Now().Unix(),
		Queues:      make([]queueSummary, 0, len(queues)),
	}
	for _, name := range queues {
		summary, err := buildQueueSummary(ctx, tc.Store, name, status, memoID, limit)
		if err != nil {
			return "", err
		}
		result.Queues = append(result.Queues, summary)
	}
	return marshalToolResult("queue status: ", result)
}

// ProjectStatusTool summarizes non-secret instance status for admins.
type ProjectStatusTool struct{}

type projectStatusArgs struct {
	IncludeTableCounts bool `json:"includeTableCounts"`
}

type projectStatusResult struct {
	GeneratedAt int64                   `json:"generatedAt"`
	Database    projectStatusDatabase   `json:"database"`
	TableCounts map[string]int64        `json:"tableCounts,omitempty"`
	Queues      []queueStatusOnly       `json:"queues"`
	AI          projectStatusAI         `json:"ai"`
	Logs        projectStatusLogSummary `json:"logs"`
}

type projectStatusDatabase struct {
	Dialect   string `json:"dialect"`
	SizeBytes int64  `json:"sizeBytes"`
}

type queueStatusOnly struct {
	Name   string           `json:"name"`
	Counts map[string]int64 `json:"counts"`
}

type projectStatusAI struct {
	Providers               int  `json:"providers"`
	ProvidersWithAPIKey     int  `json:"providersWithApiKey"`
	Agents                  int  `json:"agents"`
	AgentsEnabled           int  `json:"agentsEnabled"`
	Taggers                 int  `json:"taggers"`
	TaggersEnabled          int  `json:"taggersEnabled"`
	ChatAgents              int  `json:"chatAgents"`
	ChatAgentsEnabled       int  `json:"chatAgentsEnabled"`
	ToolsConfigured         int  `json:"toolsConfigured"`
	MemoryEnabled           bool `json:"memoryEnabled"`
	MemoryEntries           int  `json:"memoryEntries"`
	TranslationEnabled      bool `json:"translationEnabled"`
	TranscriptionConfigured bool `json:"transcriptionConfigured"`
}

type projectStatusLogSummary struct {
	Files       int   `json:"files"`
	SizeBytes   int64 `json:"sizeBytes"`
	LatestLogTs int64 `json:"latestLogTs,omitempty"`
}

func (*ProjectStatusTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "project_status",
		Description: "Summarize instance health for admins: database dialect and size, optional core table counts, AI queue counts, AI configuration counts and log file summary. Does not return API keys or secrets. Read-only and ADMIN ONLY.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"includeTableCounts": {"type": "boolean", "description": "When true, include counts for core non-secret tables."}
			}
		}`,
	}
}

func (*ProjectStatusTool) RequiresConfirmation(_ string) bool {
	return false
}

func (*ProjectStatusTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args projectStatusArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid project_status arguments")
	}
	if err := requireAdminTool(ctx, tc, "project_status"); err != nil {
		return "", err
	}

	sizeBytes, err := tc.Store.GetDriver().GetDatabaseSize(ctx)
	if err != nil {
		sizeBytes = -1
	}
	result := projectStatusResult{
		GeneratedAt: time.Now().Unix(),
		Database: projectStatusDatabase{
			Dialect:   tc.Store.GetDriver().Dialect(),
			SizeBytes: sizeBytes,
		},
		Queues: []queueStatusOnly{},
	}
	if args.IncludeTableCounts {
		counts, err := projectTableCounts(ctx, tc.Store)
		if err != nil {
			return "", err
		}
		result.TableCounts = counts
	}
	for _, queueName := range []string{queryQueueAgentReply, queryQueueMemoTag} {
		counts, err := countQueueStatuses(ctx, tc.Store, queueName, nil)
		if err != nil {
			return "", err
		}
		result.Queues = append(result.Queues, queueStatusOnly{Name: queueName, Counts: counts})
	}
	setting, err := tc.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return "", errors.Wrap(err, "failed to load AI setting")
	}
	result.AI = summarizeAISetting(setting)
	logs, err := summarizeProjectLogs(tc.Store.GetDataDir())
	if err != nil {
		return "", err
	}
	result.Logs = logs
	return marshalToolResult("project status: ", result)
}

func requireAdminTool(ctx context.Context, tc ToolContext, toolName string) error {
	if tc.Store == nil {
		return errors.New("store not available")
	}
	user, err := tc.Store.GetUser(ctx, &store.FindUser{ID: &tc.UserID})
	if err != nil {
		return errors.Wrap(err, "failed to load current user")
	}
	if user == nil || user.Role != store.RoleAdmin {
		return errors.Errorf("permission denied: %s requires an admin account", toolName)
	}
	return nil
}

func normalizeQueueName(queue string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(queue)) {
	case "":
		return "", nil
	case queryQueueAgentReply, "agent_reply", "agent":
		return queryQueueAgentReply, nil
	case queryQueueMemoTag, "memo_tag", "tag":
		return queryQueueMemoTag, nil
	default:
		return "", errors.Errorf("unsupported queue %q", queue)
	}
}

func normalizeQueueStatus(status string) (string, error) {
	status = strings.ToUpper(strings.TrimSpace(status))
	if status == "" {
		return "", nil
	}
	if !queryQueueStatusValues[status] {
		return "", errors.Errorf("unsupported queue status %q", status)
	}
	return status, nil
}

func normalizeQueueLimit(limit int) int {
	if limit <= 0 {
		return defaultQueueRows
	}
	if limit > maxQueueRows {
		return maxQueueRows
	}
	return limit
}

func resolveQueueMemoID(ctx context.Context, tc ToolContext, memoUID string, memoID int32) (*int32, error) {
	if strings.TrimSpace(memoUID) == "" {
		if memoID <= 0 {
			return nil, nil
		}
		return &memoID, nil
	}
	memo, err := getMemoByUID(ctx, tc, memoUID)
	if err != nil {
		return nil, err
	}
	if memoID > 0 && memoID != memo.ID {
		return nil, errors.Errorf("memoUid %q resolves to memoId %d, not %d", memoUID, memo.ID, memoID)
	}
	id := memo.ID
	return &id, nil
}

func buildQueueSummary(ctx context.Context, s *store.Store, queueName string, status string, memoID *int32, limit int) (queueSummary, error) {
	counts, err := countQueueStatuses(ctx, s, queueName, memoID)
	if err != nil {
		return queueSummary{}, err
	}
	tasks, err := listQueueTasks(ctx, s, queueName, status, memoID, limit)
	if err != nil {
		return queueSummary{}, err
	}
	return queueSummary{Name: queueName, Counts: counts, Tasks: tasks}, nil
}

func countQueueStatuses(ctx context.Context, s *store.Store, queueName string, memoID *int32) (map[string]int64, error) {
	query := "SELECT status, COUNT(*) AS count FROM " + queueName
	args := []any{}
	if memoID != nil {
		query += " WHERE memo_id = ?"
		args = append(args, *memoID)
	}
	query += " GROUP BY status"
	rows, err := s.QueryDatabase(ctx, query, args...)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to count %s statuses", queueName)
	}
	counts := map[string]int64{
		string(store.AgentReplyTaskPending): 0,
		string(store.AgentReplyTaskDone):    0,
		string(store.AgentReplyTaskFailed):  0,
	}
	for _, row := range rows {
		status := row["status"]
		if !queryQueueStatusValues[status] {
			continue
		}
		count, err := strconv.ParseInt(row["count"], 10, 64)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to parse %s status count", queueName)
		}
		counts[status] = count
	}
	return counts, nil
}

func listQueueTasks(ctx context.Context, s *store.Store, queueName string, status string, memoID *int32, limit int) ([]queueTask, error) {
	switch queueName {
	case queryQueueAgentReply:
		find := &store.FindAgentReplyTask{MemoID: memoID, Limit: &limit}
		if status != "" {
			find.StatusList = []store.AgentReplyTaskStatus{store.AgentReplyTaskStatus(status)}
		}
		rows, err := s.ListAgentReplyTasks(ctx, find)
		if err != nil {
			return nil, errors.Wrap(err, "failed to list agent reply queue")
		}
		tasks := make([]queueTask, 0, len(rows))
		for _, row := range rows {
			tasks = append(tasks, queueTask{
				ID:        row.ID,
				MemoID:    row.MemoID,
				AgentID:   row.AgentID,
				Status:    string(row.Status),
				DueAt:     row.DueAt,
				CreatedTs: row.CreatedTs,
				UpdatedTs: row.UpdatedTs,
			})
		}
		return tasks, nil
	case queryQueueMemoTag:
		find := &store.FindMemoTagTask{MemoID: memoID, Limit: &limit}
		if status != "" {
			find.StatusList = []store.MemoTagTaskStatus{store.MemoTagTaskStatus(status)}
		}
		rows, err := s.ListMemoTagTasks(ctx, find)
		if err != nil {
			return nil, errors.Wrap(err, "failed to list memo tag queue")
		}
		tasks := make([]queueTask, 0, len(rows))
		for _, row := range rows {
			tasks = append(tasks, queueTask{
				ID:        row.ID,
				MemoID:    row.MemoID,
				TaggerID:  row.TaggerID,
				Status:    string(row.Status),
				DueAt:     row.DueAt,
				CreatedTs: row.CreatedTs,
				UpdatedTs: row.UpdatedTs,
			})
		}
		return tasks, nil
	default:
		return nil, errors.Errorf("unsupported queue %q", queueName)
	}
}

func projectTableCounts(ctx context.Context, s *store.Store) (map[string]int64, error) {
	tables := map[string]string{
		"users":                "user",
		"memos":                "memo",
		"attachments":          "attachment",
		"inboxes":              "inbox",
		"memoShares":           "memo_share",
		"agentReplyTasks":      "agent_reply_task",
		"memoTagTasks":         "memo_tag_task",
		"conversations":        "conversation",
		"conversationMessages": "conversation_message",
	}
	counts := make(map[string]int64, len(tables))
	for label, table := range tables {
		count, err := countProjectTable(ctx, s, table)
		if err != nil {
			return nil, err
		}
		counts[label] = count
	}
	return counts, nil
}

func countProjectTable(ctx context.Context, s *store.Store, table string) (int64, error) {
	rows, err := s.QueryDatabase(ctx, "SELECT COUNT(*) AS count FROM "+quoteProjectStatusIdentifier(s, table))
	if err != nil {
		return 0, errors.Wrapf(err, "failed to count %s", table)
	}
	if len(rows) == 0 {
		return 0, nil
	}
	count, err := strconv.ParseInt(rows[0]["count"], 10, 64)
	if err != nil {
		return 0, errors.Wrapf(err, "failed to parse %s count", table)
	}
	return count, nil
}

func quoteProjectStatusIdentifier(s *store.Store, ident string) string {
	if s.GetDriver().Dialect() == "postgres" {
		return `"` + ident + `"`
	}
	return "`" + ident + "`"
}

func summarizeAISetting(setting *storepb.InstanceAISetting) projectStatusAI {
	out := projectStatusAI{}
	out.Providers = len(setting.GetProviders())
	for _, provider := range setting.GetProviders() {
		if provider.GetApiKey() != "" {
			out.ProvidersWithAPIKey++
		}
	}
	out.Agents = len(setting.GetAgents())
	for _, agent := range setting.GetAgents() {
		if agent.GetEnabled() {
			out.AgentsEnabled++
		}
	}
	out.Taggers = len(setting.GetTaggers())
	for _, tagger := range setting.GetTaggers() {
		if tagger.GetEnabled() {
			out.TaggersEnabled++
		}
	}
	out.ChatAgents = len(setting.GetChatAgents())
	for _, agent := range setting.GetChatAgents() {
		if agent.GetEnabled() {
			out.ChatAgentsEnabled++
		}
	}
	out.ToolsConfigured = len(setting.GetTools())
	out.MemoryEnabled = setting.GetMemory().GetEnabled()
	out.MemoryEntries = len(setting.GetMemory().GetEntries())
	out.TranslationEnabled = setting.GetTranslation().GetEnabled()
	out.TranscriptionConfigured = setting.GetTranscription().GetProviderId() != ""
	return out
}

func summarizeProjectLogs(dataDir string) (projectStatusLogSummary, error) {
	logsDir := filepath.Join(dataDir, "logs")
	entries, err := os.ReadDir(logsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return projectStatusLogSummary{}, nil
		}
		return projectStatusLogSummary{}, errors.Wrap(err, "failed to list log directory")
	}
	var out projectStatusLogSummary
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), getLogsFilePrefix) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return projectStatusLogSummary{}, errors.Wrap(err, "failed to read log file info")
		}
		out.Files++
		out.SizeBytes += info.Size()
		if ts := info.ModTime().Unix(); ts > out.LatestLogTs {
			out.LatestLogTs = ts
		}
	}
	return out, nil
}
