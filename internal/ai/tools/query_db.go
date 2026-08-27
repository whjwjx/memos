package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/ai/chat"
	"github.com/usememos/memos/store"
)

// confirmKeyword is the exact keyword a user must type to approve a write
// operation of query_db. It is injected by the assistant after the user
// approves the confirmation card, never set by the model itself.
const confirmKeyword = "yes"

// queryDBWriteOperations are the operations that mutate data and therefore
// require the user's explicit confirmation.
var queryDBWriteOperations = map[string]bool{
	"insert": true,
	"update": true,
	"delete": true,
}

// queryDBTables maps every whitelisted table to its allowed columns. Sensitive
// tables (system_setting, idp, user_identity, resource, webhook) are absent so
// they are rejected outright; sensitive columns (user.password_hash,
// attachment.blob) are simply not listed.
var queryDBTables = map[string]map[string]bool{
	"memo":                 setOf("id", "uid", "creator_id", "created_ts", "updated_ts", "row_status", "content", "visibility", "pinned", "payload", "scheduled_time", "scheduled_duration"),
	"user":                 setOf("id", "created_ts", "updated_ts", "row_status", "username", "role", "email", "nickname", "avatar_url", "description"),
	"attachment":           setOf("id", "uid", "creator_id", "created_ts", "updated_ts", "filename", "type", "size", "memo_id", "storage_type", "reference", "payload"),
	"tag":                  setOf("name", "creator_id"),
	"reaction":             setOf("id", "created_ts", "creator_id", "memo_id", "reaction_type"),
	"inbox":                setOf("id", "created_ts", "sender_id", "receiver_id", "status", "message"),
	"memo_relation":        setOf("memo_id", "related_memo_id", "type"),
	"memo_share":           setOf("id", "uid", "memo_id", "creator_id", "created_ts", "expires_ts"),
	"agent_reply_task":     setOf("id", "memo_id", "agent_id", "status", "due_at", "created_ts", "updated_ts"),
	"memo_tag_task":        setOf("id", "memo_id", "tagger_id", "status", "due_at", "created_ts", "updated_ts"),
	"conversation":         setOf("id", "uid", "user_id", "title", "agent_id", "created_ts", "updated_ts"),
	"conversation_message": setOf("id", "conversation_id", "role", "content", "tool_calls", "tool_call_id", "name", "created_ts", "updated_ts"),
}

// queryDBWhereOperators is the whitelist of allowed comparison operators in
// where conditions. Anything else is rejected before reaching the database.
var queryDBWhereOperators = map[string]bool{
	"=":    true,
	"!=":   true,
	">":    true,
	"<":    true,
	">=":   true,
	"<=":   true,
	"LIKE": true,
}

// maxQueryDBRows caps how many rows a single select may return.
const maxQueryDBRows = 100

// defaultQueryDBRows is applied when the model omits limit.
const defaultQueryDBRows = 10

// maxQueryDBValueLength truncates returned cell values so a single row cannot
// blow up the model context.
const maxQueryDBValueLength = 512

// QueryDBTool lets the assistant inspect and, with explicit user confirmation,
// modify database rows through a tightly whitelisted SQL surface. It is admin
// only: data in the database may include private information of other users.
type QueryDBTool struct{}

type queryDBArgs struct {
	Operation      string         `json:"operation"`
	Table          string         `json:"table"`
	Fields         []string       `json:"fields"`
	Where          []queryDBWhere `json:"where"`
	Values         map[string]any `json:"values"`
	Limit          int            `json:"limit"`
	ConfirmKeyword string         `json:"confirm_keyword"`
}

type queryDBWhere struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value"`
}

func (*QueryDBTool) Spec() chat.ToolSpec {
	return chat.ToolSpec{
		Name:        "query_db",
		Description: "Query the Memos database. Use select to read rows; insert/update/delete modify the database and require the user to approve them (you must call the tool and the client will ask the user to confirm before anything runs). Only whitelisted tables are accessible: memo, user, attachment, tag, reaction, inbox, memo_relation, memo_share, agent_reply_task, memo_tag_task, conversation, conversation_message. Sensitive tables (system_setting, idp, user_identity, resource, webhook) and columns (user.password_hash, attachment.blob) are blocked. Values are always bound as parameters — never inject raw SQL. ADMIN ONLY.",
		ParametersJSON: `{
			"type": "object",
			"properties": {
				"operation": {"type": "string", "enum": ["select", "insert", "update", "delete"], "description": "Operation to run. select reads rows; the others modify the database."},
				"table": {"type": "string", "description": "Whitelisted table name."},
				"fields": {"type": "array", "items": {"type": "string"}, "description": "Columns to select, or columns to write for insert/update. Empty for select means all allowed columns."},
				"where": {"type": "array", "items": {"type": "object", "properties": {"field": {"type": "string"}, "op": {"type": "string", "enum": ["=", "!=", ">", "<", ">=", "<=", "LIKE"]}, "value": {}}, "required": ["field", "op", "value"]}, "description": "Filter conditions, combined with AND. Required for update/delete."},
				"values": {"type": "object", "description": "Column to value map for insert/update."},
				"limit": {"type": "integer", "description": "Maximum rows to return for select (1-100, default 10)."},
				"confirm_keyword": {"type": "string", "description": "Reserved for the system: the user's typed confirmation keyword. Do not set this yourself."}
			},
			"required": ["operation", "table"]
		}`,
	}
}

func (*QueryDBTool) RequiresConfirmation(argsJSON string) bool {
	var args queryDBArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return false
	}
	return queryDBWriteOperations[args.Operation]
}

func (t *QueryDBTool) Run(ctx context.Context, tc ToolContext, argsJSON string) (string, error) {
	var args queryDBArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", errors.Wrap(err, "invalid query_db arguments")
	}
	if args.Operation == "" {
		return "", errors.New("operation is required (select, insert, update or delete)")
	}
	if args.Table == "" {
		return "", errors.New("table is required")
	}
	if tc.Store == nil {
		return "", errors.New("store not available")
	}

	// query_db is admin-only: the data it touches belongs to all users.
	user, err := tc.Store.GetUser(ctx, &store.FindUser{ID: &tc.UserID})
	if err != nil {
		return "", errors.Wrap(err, "failed to load current user")
	}
	if user == nil || user.Role != store.RoleAdmin {
		return "", errors.New("permission denied: query_db requires an admin account")
	}

	columns, ok := queryDBTables[args.Table]
	if !ok {
		return "", errors.Errorf("table %q is not accessible", args.Table)
	}
	if !queryDBWriteOperations[args.Operation] && args.Operation != "select" {
		return "", errors.Errorf("unknown operation %q", args.Operation)
	}

	fields, err := validateQueryDBFields(args.Fields, columns)
	if err != nil {
		return "", err
	}
	whereArgs, err := validateQueryDBWhere(args.Where, columns)
	if err != nil {
		return "", err
	}

	switch args.Operation {
	case "select":
		limit := args.Limit
		if limit <= 0 {
			limit = defaultQueryDBRows
		}
		if limit > maxQueryDBRows {
			limit = maxQueryDBRows
		}
		query := fmt.Sprintf("SELECT %s FROM %s", strings.Join(fields, ", "), args.Table)
		if len(args.Where) > 0 {
			query += " WHERE " + joinQueryDBConditions(args.Where)
		}
		query += fmt.Sprintf(" LIMIT %d", limit)
		rows, err := tc.Store.QueryDatabase(ctx, query, whereArgs...)
		if err != nil {
			return "", errors.Wrap(err, "query_db select failed")
		}
		if len(rows) == 0 {
			return "(no rows)", nil
		}
		for _, row := range rows {
			for k, v := range row {
				if len(v) > maxQueryDBValueLength {
					row[k] = v[:maxQueryDBValueLength] + "…"
				}
			}
		}
		raw, err := json.Marshal(rows)
		if err != nil {
			return "", errors.Wrap(err, "failed to marshal query result")
		}
		return fmt.Sprintf("rows (%d): %s", len(rows), string(raw)), nil
	case "insert":
		if len(fields) == 0 {
			return "", errors.New("fields are required for insert")
		}
		values, err := validateQueryDBValues(args.Values, fields)
		if err != nil {
			return "", err
		}
		placeholders := strings.Repeat("?, ", len(fields))
		placeholders = strings.TrimSuffix(placeholders, ", ")
		query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", args.Table, strings.Join(fields, ", "), placeholders)
		affected, err := tc.Store.ExecDatabase(ctx, query, values...)
		if err != nil {
			return "", errors.Wrap(err, "query_db insert failed")
		}
		return fmt.Sprintf("inserted %d row(s) into %s", affected, args.Table), nil
	case "update":
		if len(fields) == 0 {
			return "", errors.New("fields are required for update")
		}
		if len(args.Where) == 0 {
			return "", errors.New("update requires at least one where condition")
		}
		if err := requireConfirmKeyword(args.ConfirmKeyword); err != nil {
			return "", err
		}
		values, err := validateQueryDBValues(args.Values, fields)
		if err != nil {
			return "", err
		}
		setParts := make([]string, 0, len(fields))
		for _, f := range fields {
			setParts = append(setParts, f+"=?")
		}
		query := fmt.Sprintf("UPDATE %s SET %s WHERE %s", args.Table, strings.Join(setParts, ", "), joinQueryDBConditions(args.Where))
		allArgs := append(values, whereArgs...)
		affected, err := tc.Store.ExecDatabase(ctx, query, allArgs...)
		if err != nil {
			return "", errors.Wrap(err, "query_db update failed")
		}
		return fmt.Sprintf("updated %d row(s) in %s", affected, args.Table), nil
	case "delete":
		if len(args.Where) == 0 {
			return "", errors.New("delete requires at least one where condition")
		}
		if err := requireConfirmKeyword(args.ConfirmKeyword); err != nil {
			return "", err
		}
		query := fmt.Sprintf("DELETE FROM %s WHERE %s", args.Table, joinQueryDBConditions(args.Where))
		affected, err := tc.Store.ExecDatabase(ctx, query, whereArgs...)
		if err != nil {
			return "", errors.Wrap(err, "query_db delete failed")
		}
		return fmt.Sprintf("deleted %d row(s) from %s", affected, args.Table), nil
	}
	return "", errors.Errorf("unknown operation %q", args.Operation)
}

// validateQueryDBFields checks the requested columns against the table's
// whitelist. An empty field list resolves to all allowed columns (sorted for a
// stable output).
func validateQueryDBFields(fields []string, allowed map[string]bool) ([]string, error) {
	if len(fields) == 0 {
		out := make([]string, 0, len(allowed))
		for col := range allowed {
			out = append(out, col)
		}
		sort.Strings(out)
		return out, nil
	}
	out := make([]string, 0, len(fields))
	seen := make(map[string]bool, len(fields))
	for _, f := range fields {
		if !allowed[f] {
			return nil, errors.Errorf("column %q is not accessible", f)
		}
		if seen[f] {
			continue
		}
		seen[f] = true
		out = append(out, f)
	}
	return out, nil
}

// validateQueryDBWhere verifies every condition's column and operator against
// the whitelists and collects the parameter values in order.
func validateQueryDBWhere(conditions []queryDBWhere, allowed map[string]bool) ([]any, error) {
	var args []any
	for _, c := range conditions {
		if !allowed[c.Field] {
			return nil, errors.Errorf("column %q is not accessible", c.Field)
		}
		if !queryDBWhereOperators[c.Op] {
			return nil, errors.Errorf("operator %q is not allowed", c.Op)
		}
		args = append(args, c.Value)
	}
	return args, nil
}

// validateQueryDBValues ensures every field has exactly one value.
func validateQueryDBValues(values map[string]any, fields []string) ([]any, error) {
	if values == nil {
		return nil, errors.New("values are required for insert/update")
	}
	out := make([]any, 0, len(fields))
	for _, f := range fields {
		v, ok := values[f]
		if !ok {
			return nil, errors.Errorf("missing value for column %q", f)
		}
		out = append(out, v)
	}
	return out, nil
}

func requireConfirmKeyword(keyword string) error {
	if strings.TrimSpace(keyword) != confirmKeyword {
		return errors.Errorf("write operation requires explicit confirmation: the user must type %q to confirm", confirmKeyword)
	}
	return nil
}

// joinQueryDBConditions renders the verified where conditions as a
// parameterized predicate list joined by AND.
func joinQueryDBConditions(conditions []queryDBWhere) string {
	parts := make([]string, 0, len(conditions))
	for _, c := range conditions {
		parts = append(parts, fmt.Sprintf("%s %s ?", c.Field, c.Op))
	}
	return strings.Join(parts, " AND ")
}

func setOf(cols ...string) map[string]bool {
	m := make(map[string]bool, len(cols))
	for _, c := range cols {
		m[c] = true
	}
	return m
}
