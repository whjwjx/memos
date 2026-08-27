package tools

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/store"
)

// maxGetLogsLines caps how many log lines one call may return.
const maxGetLogsLines = 200

// defaultGetLogsLines is applied when the model omits limit.
const defaultGetLogsLines = 50

// getLogsFilePrefix matches the daily log files written by cmd/memos.
const getLogsFilePrefix = "memos-"

// logSensitiveValuePattern redacts credential-looking values before log lines
// are handed to the model.
var logSensitiveValuePattern = regexp.MustCompile(`(?i)([a-z0-9_-]*(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)[a-z0-9_-]*)\s*[=:]\s*[^\s,;"']+`)

// GetLogsTool lets the assistant inspect recent server log lines. It is admin
// only: logs may contain request details of other users.
type GetLogsTool struct{}

type getLogsArgs struct {
	// Limit caps the number of returned lines (default 50, max 200).
	Limit int `json:"limit"`
	// Level filters lines to a single severity (debug/info/warn/error).
	Level string `json:"level"`
	// Since, when set, keeps only lines at or after this RFC3339 timestamp.
	Since string `json:"since"`
}

func (*GetLogsTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "get_logs",
		Description: "Read recent server log lines from the data directory's logs folder. Useful for debugging requests, database errors or agent activity. Sensitive values (API keys, tokens, passwords, secrets) are redacted. ADMIN ONLY.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"limit": {"type": "integer", "description": "Maximum number of lines to return (1-200, default 50)."},
				"level": {"type": "string", "enum": ["debug", "info", "warn", "error"], "description": "Optional severity filter."},
				"since": {"type": "string", "description": "Optional RFC3339 timestamp; only lines at or after it are returned."}
			}
		}`,
	}
}

func (*GetLogsTool) RequiresConfirmation(_ string) bool {
	return false
}

func (t *GetLogsTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args getLogsArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid get_logs arguments")
	}
	if tc.Store == nil {
		return "", errors.New("store not available")
	}
	if args.Level != "" && !isLogLevel(args.Level) {
		return "", errors.Errorf("invalid level %q: must be debug, info, warn or error", args.Level)
	}
	var since time.Time
	if args.Since != "" {
		parsed, err := time.Parse(time.RFC3339, args.Since)
		if err != nil {
			return "", errors.Wrap(err, "invalid since timestamp (use RFC3339)")
		}
		since = parsed
	}
	limit := args.Limit
	if limit <= 0 {
		limit = defaultGetLogsLines
	}
	if limit > maxGetLogsLines {
		limit = maxGetLogsLines
	}

	// get_logs is admin-only: logs may expose internal details.
	user, err := tc.Store.GetUser(ctx, &store.FindUser{ID: &tc.UserID})
	if err != nil {
		return "", errors.Wrap(err, "failed to load current user")
	}
	if user == nil || user.Role != store.RoleAdmin {
		return "", errors.New("permission denied: get_logs requires an admin account")
	}

	logsDir := filepath.Join(tc.Store.GetDataDir(), "logs")
	lines, err := tailLogLines(logsDir, limit, args.Level, since)
	if err != nil {
		return "", errors.Wrap(err, "failed to read logs")
	}
	if len(lines) == 0 {
		return "(no log lines match)", nil
	}
	return strings.Join(lines, "\n"), nil
}

func isLogLevel(s string) bool {
	switch strings.ToLower(s) {
	case "debug", "info", "warn", "error":
		return true
	}
	return false
}

// tailLogLines collects the tail of the newest log files (up to two files, so
// the most recent day is included even when today's file is still tiny), applies
// the level/since filters and returns at most limit redacted lines.
func tailLogLines(logsDir string, limit int, level string, since time.Time) ([]string, error) {
	entries, err := os.ReadDir(logsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, errors.Wrap(err, "failed to list log directory")
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasPrefix(e.Name(), getLogsFilePrefix) {
			continue
		}
		files = append(files, filepath.Join(logsDir, e.Name()))
	}
	if len(files) == 0 {
		return nil, nil
	}
	sort.Slice(files, func(i, j int) bool {
		li, ei := fileInfo(files[i])
		lj, ej := fileInfo(files[j])
		if ei != nil || ej != nil {
			return files[i] > files[j]
		}
		return li.ModTime().After(lj.ModTime())
	})

	var all []string
	for i := 0; i < len(files) && i < 2; i++ {
		fileLines, err := readLogLines(files[i], level, since)
		if err != nil {
			return nil, err
		}
		all = append(all, fileLines...)
	}
	if len(all) > limit {
		all = all[len(all)-limit:]
	}
	return all, nil
}

func fileInfo(path string) (os.FileInfo, error) {
	return os.Stat(path)
}

// readLogLines reads a log file line by line, redacting sensitive values and
// applying the level/since filters.
func readLogLines(path string, level string, since time.Time) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to open log file %s", path)
	}
	defer f.Close()

	var lines []string
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		if sinceIsAfterLine(line, since) {
			continue
		}
		if level != "" && lineLevel(line) != "" && lineLevel(line) != strings.ToLower(level) {
			continue
		}
		lines = append(lines, redactLogLine(line))
	}
	if err := scanner.Err(); err != nil {
		return nil, errors.Wrapf(err, "failed to read log file %s", path)
	}
	return lines, nil
}

// sinceIsAfterLine reports whether the log line's timestamp is before the since
// threshold. Lines without a parseable timestamp are always kept.
func sinceIsAfterLine(line string, since time.Time) bool {
	if since.IsZero() {
		return false
	}
	if idx := strings.Index(line, "time="); idx >= 0 {
		rest := line[idx+len("time="):]
		if end := strings.IndexAny(rest, " \t"); end >= 0 {
			rest = rest[:end]
		}
		if ts, err := time.Parse(time.RFC3339Nano, rest); err == nil {
			return ts.Before(since)
		}
	}
	return false
}

// lineLevel extracts the level=... field from a slog text line, or "" when the
// line has none (such lines pass any level filter).
func lineLevel(line string) string {
	if idx := strings.Index(line, "level="); idx >= 0 {
		rest := line[idx+len("level="):]
		if end := strings.IndexAny(rest, " \t"); end >= 0 {
			rest = rest[:end]
		}
		return strings.ToLower(rest)
	}
	return ""
}

// redactLogLine masks credential-looking values in a log line.
func redactLogLine(line string) string {
	return logSensitiveValuePattern.ReplaceAllString(line, "$1=***")
}
