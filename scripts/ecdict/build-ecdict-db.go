//go:build ignore

package main

import (
	"context"
	"database/sql"
	"encoding/csv"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

var ecdictColumns = []string{
	"word",
	"phonetic",
	"definition",
	"translation",
	"pos",
	"collins",
	"oxford",
	"tag",
	"bnc",
	"frq",
	"exchange",
	"detail",
	"audio",
}

func main() {
	var csvPath string
	var outputPath string
	flag.StringVar(&csvPath, "csv", "", "path to ECDICT CSV file")
	flag.StringVar(&outputPath, "out", "", "path to output SQLite database")
	flag.Parse()

	if csvPath == "" || outputPath == "" {
		fatalf("-csv and -out are required")
	}

	if err := build(context.Background(), csvPath, outputPath); err != nil {
		fatalf("%v", err)
	}
}

func build(ctx context.Context, csvPath string, outputPath string) error {
	input, err := os.Open(csvPath)
	if err != nil {
		return fmt.Errorf("open CSV: %w", err)
	}
	defer input.Close()

	tempPath := outputPath + ".tmp"
	if err := os.MkdirAll(filepath.Dir(outputPath), 0770); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}
	_ = os.Remove(tempPath)

	db, err := sql.Open("sqlite", tempPath)
	if err != nil {
		return fmt.Errorf("open sqlite database: %w", err)
	}
	defer db.Close()

	if err := initDatabase(ctx, db); err != nil {
		return err
	}

	reader := csv.NewReader(input)
	reader.FieldsPerRecord = -1
	reader.ReuseRecord = true

	firstRecord, err := reader.Read()
	if err != nil {
		return fmt.Errorf("read CSV header: %w", err)
	}
	hasHeader := hasECDICTHeader(firstRecord)

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	stmt, err := tx.PrepareContext(ctx, `
INSERT OR REPLACE INTO stardict (
  word, sw, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange, detail, audio
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
	if err != nil {
		return fmt.Errorf("prepare insert: %w", err)
	}
	defer stmt.Close()

	count := 0
	if !hasHeader {
		if err := insertRecord(ctx, stmt, firstRecord); err != nil {
			_ = tx.Rollback()
			return err
		}
		count++
	}

	for {
		record, err := reader.Read()
		if err != nil {
			if err == io.EOF {
				break
			}
			_ = tx.Rollback()
			return fmt.Errorf("read CSV record: %w", err)
		}
		if err := insertRecord(ctx, stmt, record); err != nil {
			_ = tx.Rollback()
			return err
		}
		count++
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}
	if _, err := db.ExecContext(ctx, "VACUUM"); err != nil {
		return fmt.Errorf("vacuum database: %w", err)
	}
	if err := db.Close(); err != nil {
		return fmt.Errorf("close database: %w", err)
	}
	if err := os.Rename(tempPath, outputPath); err != nil {
		return fmt.Errorf("replace output database: %w", err)
	}

	fmt.Printf("Built %s with %d entries\n", outputPath, count)
	return nil
}

func initDatabase(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, `
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;

CREATE TABLE stardict (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL UNIQUE,
  word VARCHAR(64) COLLATE NOCASE NOT NULL UNIQUE,
  sw VARCHAR(64) COLLATE NOCASE NOT NULL,
  phonetic VARCHAR(64),
  definition TEXT,
  translation TEXT,
  pos VARCHAR(16),
  collins INTEGER DEFAULT 0,
  oxford INTEGER DEFAULT 0,
  tag VARCHAR(64),
  bnc INTEGER DEFAULT NULL,
  frq INTEGER DEFAULT NULL,
  exchange TEXT,
  detail TEXT,
  audio TEXT
);

CREATE UNIQUE INDEX stardict_1 ON stardict (id);
CREATE UNIQUE INDEX stardict_2 ON stardict (word);
CREATE INDEX stardict_3 ON stardict (sw, word COLLATE NOCASE);
CREATE INDEX sd_1 ON stardict (word COLLATE NOCASE);
`)
	if err != nil {
		return fmt.Errorf("initialize database: %w", err)
	}
	return nil
}

func insertRecord(ctx context.Context, stmt *sql.Stmt, record []string) error {
	values := normalizeRecord(record)
	word := strings.TrimSpace(values[0])
	if word == "" {
		return nil
	}
	sw := strings.ToLower(word)
	if _, err := stmt.ExecContext(
		ctx,
		word,
		sw,
		values[1],
		values[2],
		values[3],
		values[4],
		nullInt(values[5]),
		nullInt(values[6]),
		values[7],
		nullInt(values[8]),
		nullInt(values[9]),
		values[10],
		values[11],
		values[12],
	); err != nil {
		return fmt.Errorf("insert %q: %w", word, err)
	}
	return nil
}

func normalizeRecord(record []string) []string {
	values := make([]string, len(ecdictColumns))
	copy(values, record)
	for i := range values {
		values[i] = strings.TrimSpace(values[i])
	}
	return values
}

func nullInt(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func hasECDICTHeader(record []string) bool {
	if len(record) < len(ecdictColumns) {
		return false
	}
	for i, column := range ecdictColumns {
		if strings.TrimSpace(strings.ToLower(record[i])) != column {
			return false
		}
	}
	return true
}

func fatalf(format string, args ...any) {
	_, _ = fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
