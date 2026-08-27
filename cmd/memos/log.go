package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/spf13/viper"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

// logFileNamePrefix matches the daily log files written by initLogFile.
const logFileNamePrefix = "memos-"

// defaultLogRetentionDays controls how many days of daily log files are kept
// under the data directory before old files are pruned. It is the default used
// at startup and whenever the admin log retention setting is not persisted.
const defaultLogRetentionDays = 3

// logCleanInterval is how often the background log cleaner runs. Log files are
// rotated daily, so a per-hour sweep is more than frequent enough.
const logCleanInterval = time.Hour

func parseSlogLevel(s string) (slog.Level, error) {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return slog.LevelInfo, errors.Errorf("unknown log level %q: must be debug, info, warn, or error", s)
	}
}

func newLogger(level slog.Level, w io.Writer) *slog.Logger {
	return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: level}))
}

// initLogFile appends to a daily-rotated log file under dataDir/logs and
// switches the default slog logger to write to both stderr and the file. On
// failure the stderr-only logger is kept so startup can continue.
func initLogFile(dataDir string) error {
	logsDir := filepath.Join(dataDir, "logs")
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		return errors.Wrapf(err, "failed to create log directory %q", logsDir)
	}

	level, err := parseSlogLevel(viper.GetString("log-level"))
	if err != nil {
		level = slog.LevelInfo
	}
	path := filepath.Join(logsDir, fmt.Sprintf("memos-%s.log", time.Now().Format("2006-01-02")))
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return errors.Wrapf(err, "failed to open log file %q", path)
	}
	slog.SetDefault(newLogger(level, io.MultiWriter(os.Stderr, f)))
	return nil
}

// pruneOldLogs removes daily memos-*.log files older than the retention window.
// Only files matching the memos log pattern are touched, so user files placed
// in the logs directory are never removed.
func pruneOldLogs(logsDir string, retentionDays int) {
	cutoff := time.Now().AddDate(0, 0, -retentionDays)
	entries, err := os.ReadDir(logsDir)
	if err != nil {
		return
	}
	removed := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !strings.HasPrefix(e.Name(), logFileNamePrefix) || !strings.HasSuffix(e.Name(), ".log") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			if err := os.Remove(filepath.Join(logsDir, e.Name())); err == nil {
				removed++
			}
		}
	}
	if removed > 0 {
		slog.Info("pruned old log files", "count", removed, "retention_days", retentionDays)
	}
}

// startLogCleaner prunes old log files periodically while the server runs, so
// cleanup does not depend on restarts. It runs once immediately after startup
// (covering the startup pruning need) and then on every tick, always honoring
// the admin-controlled InstanceLogSetting. The goroutine exits when ctx is
// cancelled.
func startLogCleaner(ctx context.Context, dataDir string, storeInstance *store.Store) {
	ticker := time.NewTicker(logCleanInterval)
	go func() {
		defer ticker.Stop()
		runLogClean(ctx, dataDir, storeInstance)
		for {
			select {
			case <-ticker.C:
				runLogClean(ctx, dataDir, storeInstance)
			case <-ctx.Done():
				return
			}
		}
	}()
}

// logCleanupDecision resolves the admin log retention setting into a concrete
// cleanup action: whether to prune at all, and with which retention window.
// A missing setting falls back to the default retention window so unconfigured
// instances still get bounded log growth; an explicitly disabled setting
// disables pruning entirely.
func logCleanupDecision(setting *storepb.InstanceLogSetting) (shouldPrune bool, retentionDays int) {
	if setting == nil {
		return true, defaultLogRetentionDays
	}
	if !setting.Enabled {
		return false, 0
	}
	days := int(setting.RetentionDays)
	if days <= 0 {
		days = defaultLogRetentionDays
	}
	return true, days
}

func runLogClean(ctx context.Context, dataDir string, storeInstance *store.Store) {
	setting, err := storeInstance.GetInstanceLogSetting(ctx)
	if err != nil {
		slog.Warn("failed to load log retention setting, skipping periodic prune", "error", err)
		return
	}
	shouldPrune, retentionDays := logCleanupDecision(setting)
	if !shouldPrune {
		return
	}
	pruneOldLogs(filepath.Join(dataDir, "logs"), retentionDays)
}
