package store

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
)

// QueryDatabase runs a read query against the underlying database with the
// given arguments (bound as parameters) and returns the rows as a slice of
// column-to-value maps. All values are stringified so the result can be
// embedded in model-facing text; NULL becomes an empty string. QueryDatabase is
// the execution backend for the query_db AI tool and must only be called with
// queries built from whitelisted tables and columns.
func (s *Store) QueryDatabase(ctx context.Context, query string, args ...any) ([]map[string]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if s.driver.Dialect() == "postgres" {
		query = convertPostgresPlaceholders(query)
	}

	db := s.driver.GetDB()
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, errors.Wrap(err, "failed to query database")
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		return nil, errors.Wrap(err, "failed to read query columns")
	}
	result := make([]map[string]string, 0)
	for rows.Next() {
		raw := make([]any, len(columns))
		ptrs := make([]any, len(columns))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, errors.Wrap(err, "failed to scan row")
		}
		row := make(map[string]string, len(columns))
		for i, column := range columns {
			row[column] = stringifyDBValue(raw[i])
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, errors.Wrap(err, "failed to iterate rows")
	}
	return result, nil
}

// ExecDatabase runs a write statement (INSERT/UPDATE/DELETE) with parameter
// bound arguments and returns the number of affected rows. It is the execution
// backend for the query_db AI tool; callers must enforce the table/column
// whitelists and the confirm_keyword before calling it.
func (s *Store) ExecDatabase(ctx context.Context, query string, args ...any) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if s.driver.Dialect() == "postgres" {
		query = convertPostgresPlaceholders(query)
	}

	db := s.driver.GetDB()
	res, err := db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, errors.Wrap(err, "failed to execute database statement")
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0, errors.Wrap(err, "failed to read affected rows")
	}
	return affected, nil
}

// convertPostgresPlaceholders rewrites "?" placeholders to "$1/$2/..." so the
// same parameterized query can run against PostgreSQL, which uses positional
// parameters instead of the ANSI question-mark style.
func convertPostgresPlaceholders(query string) string {
	var b strings.Builder
	b.Grow(len(query))
	n := 0
	inQuote := false
	quote := byte(0)
	for i := 0; i < len(query); i++ {
		ch := query[i]
		if inQuote {
			b.WriteByte(ch)
			if ch == quote {
				// Handle escaped quotes inside identifiers/strings.
				if i+1 < len(query) && query[i+1] == quote {
					b.WriteByte(query[i+1])
					i++
					continue
				}
				inQuote = false
			}
			continue
		}
		switch ch {
		case '\'', '"':
			inQuote = true
			quote = ch
			b.WriteByte(ch)
		case '?':
			n++
			b.WriteString("$" + strconv.Itoa(n))
		default:
			b.WriteByte(ch)
		}
	}
	return b.String()
}

// stringifyDBValue converts a scanned database value to its textual form.
func stringifyDBValue(v any) string {
	switch val := v.(type) {
	case nil:
		return ""
	case []byte:
		return string(val)
	case string:
		return val
	case time.Time:
		return val.Format(time.RFC3339)
	case int64:
		return strconv.FormatInt(val, 10)
	case int32:
		return strconv.FormatInt(int64(val), 10)
	case int:
		return strconv.Itoa(val)
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(val), 'f', -1, 32)
	case bool:
		return strconv.FormatBool(val)
	default:
		return fmt.Sprintf("%v", val)
	}
}
