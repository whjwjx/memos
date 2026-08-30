package dictionary

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/pkg/errors"
	_ "modernc.org/sqlite"
)

var lookupWordRegexp = regexp.MustCompile(`^[A-Za-z][A-Za-z'-]{0,63}$`)

// Entry is one ECDICT dictionary record.
type Entry struct {
	Word        string `json:"word"`
	Phonetic    string `json:"phonetic,omitempty"`
	Definition  string `json:"definition,omitempty"`
	Translation string `json:"translation,omitempty"`
	Pos         string `json:"pos,omitempty"`
	Tag         string `json:"tag,omitempty"`
	Exchange    string `json:"exchange,omitempty"`
	Source      string `json:"source"`
}

// Lookup returns the dictionary entry for a single English word.
func Lookup(ctx context.Context, dataDir string, word string) (*Entry, bool, error) {
	normalizedWord, ok := NormalizeLookupWord(word)
	if !ok {
		return nil, false, nil
	}

	dbPath := filepath.Join(dataDir, "dictionaries", "ecdict.db")
	if _, err := os.Stat(dbPath); err != nil {
		if os.IsNotExist(err) {
			return nil, false, nil
		}
		return nil, false, errors.Wrap(err, "failed to stat dictionary database")
	}

	db, err := sql.Open("sqlite", dbPath+"?mode=ro&immutable=1")
	if err != nil {
		return nil, true, errors.Wrap(err, "failed to open dictionary database")
	}
	defer db.Close()

	entry, err := queryEntry(ctx, db, normalizedWord)
	if err != nil {
		return nil, true, err
	}
	return entry, true, nil
}

// NormalizeLookupWord validates and normalizes a single English dictionary lookup token.
func NormalizeLookupWord(word string) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(word))
	if !lookupWordRegexp.MatchString(normalized) {
		return "", false
	}
	return normalized, true
}

func queryEntry(ctx context.Context, db *sql.DB, word string) (*Entry, error) {
	row := db.QueryRowContext(
		ctx,
		`
SELECT word, phonetic, definition, translation, pos, tag, exchange
FROM stardict
WHERE lower(word) = ?
LIMIT 1
`,
		word,
	)

	var phonetic, definition, translation, pos, tag, exchange sql.NullString
	entry := &Entry{Source: "ECDICT"}
	if err := row.Scan(&entry.Word, &phonetic, &definition, &translation, &pos, &tag, &exchange); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, errors.Wrap(err, "failed to query dictionary entry")
	}
	entry.Phonetic = phonetic.String
	entry.Definition = definition.String
	entry.Translation = translation.String
	entry.Pos = pos.String
	entry.Tag = tag.String
	entry.Exchange = exchange.String
	return entry, nil
}
