package main

import (
	"bytes"
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
)

func TestParseSlogLevel(t *testing.T) {
	tests := []struct {
		input     string
		wantLevel slog.Level
		wantErr   bool
	}{
		{"debug", slog.LevelDebug, false},
		{"info", slog.LevelInfo, false},
		{"warn", slog.LevelWarn, false},
		{"error", slog.LevelError, false},
		{"DEBUG", slog.LevelDebug, false},
		{"INFO", slog.LevelInfo, false},
		{"WARN", slog.LevelWarn, false},
		{"ERROR", slog.LevelError, false},
		{"invalid", slog.LevelInfo, true},
		{"", slog.LevelInfo, true},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := parseSlogLevel(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseSlogLevel(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
			if got != tt.wantLevel {
				t.Errorf("parseSlogLevel(%q) = %v, want %v", tt.input, got, tt.wantLevel)
			}
		})
	}
}

func TestNewLoggerLevelFiltering(t *testing.T) {
	tests := []struct {
		level        slog.Level
		logAt        slog.Level
		msg          string
		shouldAppear bool
	}{
		// debug passes all
		{slog.LevelDebug, slog.LevelDebug, "debug-msg", true},
		{slog.LevelDebug, slog.LevelInfo, "info-msg", true},
		{slog.LevelDebug, slog.LevelWarn, "warn-msg", true},
		{slog.LevelDebug, slog.LevelError, "error-msg", true},
		// info suppresses debug
		{slog.LevelInfo, slog.LevelDebug, "debug-suppressed", false},
		{slog.LevelInfo, slog.LevelInfo, "info-visible", true},
		{slog.LevelInfo, slog.LevelWarn, "warn-visible", true},
		// warn suppresses debug+info
		{slog.LevelWarn, slog.LevelDebug, "debug-suppressed", false},
		{slog.LevelWarn, slog.LevelInfo, "info-suppressed", false},
		{slog.LevelWarn, slog.LevelWarn, "warn-visible", true},
		{slog.LevelWarn, slog.LevelError, "error-visible", true},
		// error suppresses everything below
		{slog.LevelError, slog.LevelDebug, "debug-suppressed", false},
		{slog.LevelError, slog.LevelInfo, "info-suppressed", false},
		{slog.LevelError, slog.LevelWarn, "warn-suppressed", false},
		{slog.LevelError, slog.LevelError, "error-visible", true},
	}

	for _, tt := range tests {
		var buf bytes.Buffer
		logger := newLogger(tt.level, &buf)
		logger.Log(context.TODO(), tt.logAt, tt.msg)

		appeared := strings.Contains(buf.String(), tt.msg)
		if appeared != tt.shouldAppear {
			t.Errorf("level=%s logAt=%s msg=%q: appeared=%v want=%v",
				tt.level, tt.logAt, tt.msg, appeared, tt.shouldAppear)
		}
	}
}

func TestNewLoggerOutputFormat(t *testing.T) {
	var buf bytes.Buffer
	logger := newLogger(slog.LevelDebug, &buf)
	logger.Info("hello-world", "key", "value")

	out := buf.String()
	if !strings.Contains(out, "hello-world") {
		t.Errorf("expected message in output, got: %s", out)
	}
	if !strings.Contains(out, "key=value") {
		t.Errorf("expected key=value attr in output, got: %s", out)
	}
	if !strings.Contains(out, "INFO") {
		t.Errorf("expected level in output, got: %s", out)
	}
}

func TestNewLoggerDoesNotMutateGlobalDefault(t *testing.T) {
	original := slog.Default()
	var buf bytes.Buffer
	_ = newLogger(slog.LevelError, &buf)
	if slog.Default() != original {
		t.Error("newLogger must not change slog.Default()")
	}
}

func TestPruneOldLogs(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	now := time.Now()
	old := now.AddDate(0, 0, -4)

	files := map[string]time.Time{
		"memos-old.log":     old, // must be removed (older than 3 days)
		"memos-current.log": now, // must be kept (still fresh)
		"user-file.txt":     old, // must be kept (not a memos log)
	}
	for name, modTime := range files {
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644))
		require.NoError(t, os.Chtimes(filepath.Join(dir, name), modTime, modTime))
	}

	pruneOldLogs(dir, 3)

	_, err := os.Stat(filepath.Join(dir, "memos-old.log"))
	require.True(t, os.IsNotExist(err), "old memos log should have been pruned")
	_, err = os.Stat(filepath.Join(dir, "memos-current.log"))
	require.NoError(t, err, "fresh memos log should be kept")
	_, err = os.Stat(filepath.Join(dir, "user-file.txt"))
	require.NoError(t, err, "non-memos file should be kept")
}

func TestLogCleanupDecision(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		setting   *storepb.InstanceLogSetting
		wantPrune bool
		wantDays  int
	}{
		{
			name:      "missing setting falls back to default retention",
			setting:   nil,
			wantPrune: true,
			wantDays:  defaultLogRetentionDays,
		},
		{
			name: "disabled setting disables pruning",
			setting: &storepb.InstanceLogSetting{
				Enabled:       false,
				RetentionDays: 30,
			},
			wantPrune: false,
		},
		{
			name: "enabled setting uses configured retention",
			setting: &storepb.InstanceLogSetting{
				Enabled:       true,
				RetentionDays: 30,
			},
			wantPrune: true,
			wantDays:  30,
		},
		{
			name: "enabled setting with unset days falls back to default",
			setting: &storepb.InstanceLogSetting{
				Enabled: true,
			},
			wantPrune: true,
			wantDays:  defaultLogRetentionDays,
		},
		{
			name: "enabled setting with zero days falls back to default",
			setting: &storepb.InstanceLogSetting{
				Enabled:       true,
				RetentionDays: 0,
			},
			wantPrune: true,
			wantDays:  defaultLogRetentionDays,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotPrune, gotDays := logCleanupDecision(tt.setting)
			require.Equal(t, tt.wantPrune, gotPrune)
			require.Equal(t, tt.wantDays, gotDays)
		})
	}
}
