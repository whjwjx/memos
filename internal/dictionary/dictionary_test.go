package dictionary

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNormalizeLookupWord(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		word string
		want string
		ok   bool
	}{
		{name: "lowercase", word: "right", want: "right", ok: true},
		{name: "uppercase", word: "Right", want: "right", ok: true},
		{name: "apostrophe", word: "don't", want: "don't", ok: true},
		{name: "sentence", word: "you are right", ok: false},
		{name: "url", word: "https://right.com", ok: false},
		{name: "number", word: "123", ok: false},
		{name: "chinese", word: "正确", ok: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := NormalizeLookupWord(test.word)
			require.Equal(t, test.ok, ok)
			require.Equal(t, test.want, got)
		})
	}
}

func TestLookupMissingDictionary(t *testing.T) {
	t.Parallel()

	entry, configured, err := Lookup(context.Background(), t.TempDir(), "right")
	require.NoError(t, err)
	require.False(t, configured)
	require.Nil(t, entry)
}

func TestLookupECDICTEntry(t *testing.T) {
	t.Parallel()

	dataDir := t.TempDir()
	dictDir := filepath.Join(dataDir, "dictionaries")
	require.NoError(t, os.MkdirAll(dictDir, 0770))
	dbPath := filepath.Join(dictDir, "ecdict.db")

	db, err := sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	defer db.Close()

	_, err = db.Exec(`
CREATE TABLE stardict (
  word TEXT PRIMARY KEY,
  phonetic TEXT,
  definition TEXT,
  translation TEXT,
  pos TEXT,
  tag TEXT,
  exchange TEXT
);
INSERT INTO stardict (word, phonetic, definition, translation, pos, tag, exchange)
VALUES ('right', 'rait', 'correct; proper', '正确; 右边', 'n/v/adj/adv', 'zk gk cet4 cet6', 'p:rights/d:righted/i:righting');
`)
	require.NoError(t, err)
	require.NoError(t, db.Close())

	entry, configured, err := Lookup(context.Background(), dataDir, "Right")
	require.NoError(t, err)
	require.True(t, configured)
	require.NotNil(t, entry)
	require.Equal(t, "right", entry.Word)
	require.Equal(t, "rait", entry.Phonetic)
	require.Equal(t, "正确; 右边", entry.Translation)
	require.Equal(t, "ECDICT", entry.Source)
}
