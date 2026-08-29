package v1

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/pkg/errors"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const (
	defaultBackupPageSize    = 1000
	maxBackupAttachmentWarns = 20
)

type backupManifest struct {
	Version                  string `json:"version"`
	Driver                   string `json:"driver"`
	ProfileDataDir           string `json:"profileDataDir"`
	DatabasePath             string `json:"databasePath"`
	DatabaseRowsSnapshotFile string `json:"databaseRowsSnapshotFile"`
	GeneratedAt              string `json:"generatedAt"`
	TotalAttachmentCount     int    `json:"totalAttachmentCount"`
	LocalAttachmentCount     int    `json:"localAttachmentCount"`
	SkippedAttachmentCount   int    `json:"skippedAttachmentCount"`
	SkippedAttachmentReasons string `json:"skippedAttachmentReasons"`
	Note                     string `json:"note"`
}

func (s *APIV1Service) RegisterBackupRoutes(echoServer *echo.Echo) {
	authenticator := auth.NewAuthenticator(s.Store, s.Secret)
	instanceGroup := echoServer.Group("/api/v1/instance")
	instanceGroup.GET("/backup:download", func(c *echo.Context) error {
		return s.exportBackup(c, authenticator)
	})
}

func (s *APIV1Service) exportBackup(c *echo.Context, authenticator *auth.Authenticator) error {
	ctx := c.Request().Context()
	if !s.backupInProgress.CompareAndSwap(false, true) {
		return echo.NewHTTPError(http.StatusConflict, "backup is already running")
	}
	defer s.backupInProgress.Store(false)

	user, err := authenticator.AuthenticateToUser(ctx, c.Request().Header.Get(echo.HeaderAuthorization), c.Request().Header.Get("Cookie"))
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "failed authentication")
	}
	if user == nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "authentication required")
	}
	if user.Role != store.RoleAdmin {
		return echo.NewHTTPError(http.StatusForbidden, "permission denied")
	}

	driver := s.Store.GetDriver()
	if driver == nil || driver.Dialect() != "sqlite" {
		return echo.NewHTTPError(http.StatusNotImplemented, "backup currently supports sqlite only")
	}

	databasePath, err := resolveBackupDBPath(s.Profile.DSN)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to resolve database path").Wrap(err)
	}
	db := driver.GetDB()
	if db == nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database not available")
	}

	tmpDir, err := os.MkdirTemp("", "memos-backup-")
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create temporary directory").Wrap(err)
	}
	defer os.RemoveAll(tmpDir)

	backupFilename := fmt.Sprintf("memos-backup-%s.zip", time.Now().Format("20060102-150405"))
	zipFilePath := filepath.Join(tmpDir, backupFilename)
	snapshotPath := filepath.Join(tmpDir, "memos.db")

	manifest, err := s.createBackupZip(ctx, db, zipFilePath, snapshotPath, databasePath)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create backup zip").Wrap(err)
	}

	zipSize, err := getFileSize(zipFilePath)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read backup zip").Wrap(err)
	}

	c.Response().Header().Set(echo.HeaderContentType, "application/zip")
	c.Response().Header().Set(echo.HeaderContentDisposition, fmt.Sprintf(`attachment; filename="%s"`, backupFilename))
	c.Response().Header().Set(echo.HeaderContentLength, strconv.FormatInt(zipSize, 10))
	c.Response().Header().Set("Cache-Control", "no-store")

	c.Response().WriteHeader(http.StatusOK)
	slog.Info("memos backup created",
		"username", user.Username,
		"filename", backupFilename,
		"bytes", zipSize,
		"totalAttachments", manifest.TotalAttachmentCount,
		"localAttachments", manifest.LocalAttachmentCount,
		"skippedAttachments", manifest.SkippedAttachmentCount,
	)

	zipFile, err := os.Open(zipFilePath)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to open backup file").Wrap(err)
	}
	defer zipFile.Close()
	if _, err := io.Copy(c.Response(), zipFile); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to write backup file").Wrap(err)
	}
	return nil
}

func (s *APIV1Service) createBackupZip(ctx context.Context, db *sql.DB, zipFilePath string, snapshotPath string, databasePath string) (*backupManifest, error) {
	zipFile, err := os.Create(zipFilePath)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create zip file")
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	if err := createSQLiteSnapshot(ctx, db, snapshotPath); err != nil {
		return nil, errors.Wrap(err, "failed to snapshot sqlite database")
	}
	if err := addFileToZip(zipWriter, "database/memos.db", snapshotPath); err != nil {
		return nil, err
	}

	totalAttachmentCount, localAttachmentCount, skippedAttachmentCount, skippedAttachmentReasons := s.addLocalAttachmentsToZip(ctx, zipWriter)
	manifest := &backupManifest{
		Version:                  s.Profile.Version,
		Driver:                   s.Profile.Driver,
		ProfileDataDir:           s.Profile.Data,
		DatabasePath:             databasePath,
		DatabaseRowsSnapshotFile: "database/memos.db",
		GeneratedAt:              time.Now().Format(time.RFC3339),
		TotalAttachmentCount:     totalAttachmentCount,
		LocalAttachmentCount:     localAttachmentCount,
		SkippedAttachmentCount:   skippedAttachmentCount,
		SkippedAttachmentReasons: strings.Join(skippedAttachmentReasons, "; "),
		Note:                     "Database snapshot is sqlite VACUUM INTO result; local attachments are embedded, S3/database blobs are not included.",
	}
	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, errors.Wrap(err, "failed to render backup manifest")
	}
	if err := writeManifestToZip(zipWriter, manifestData); err != nil {
		return nil, err
	}
	return manifest, nil
}

func createSQLiteSnapshot(ctx context.Context, db *sql.DB, outputPath string) error {
	if err := os.Remove(outputPath); err != nil && !os.IsNotExist(err) {
		return errors.Wrap(err, "failed to remove stale sqlite snapshot")
	}
	sanitizedPath := strings.ReplaceAll(outputPath, "'", "''")
	stmt := fmt.Sprintf("VACUUM INTO '%s'", sanitizedPath)
	_, err := db.ExecContext(ctx, stmt)
	if err != nil {
		return errors.Wrap(err, "failed to run sqlite VACUUM INTO")
	}
	return nil
}

func addFileToZip(zipWriter *zip.Writer, entryName string, filePath string) error {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return errors.Wrapf(err, "failed to stat file %s", filePath)
	}
	if fileInfo.IsDir() {
		return errors.Errorf("file path %s is a directory", filePath)
	}

	sourceFile, err := os.Open(filePath)
	if err != nil {
		return errors.Wrapf(err, "failed to open file %s", filePath)
	}
	defer sourceFile.Close()

	zipEntry, err := zipWriter.Create(entryName)
	if err != nil {
		return errors.Wrapf(err, "failed to create zip entry %s", entryName)
	}

	if _, err := io.Copy(zipEntry, sourceFile); err != nil {
		return errors.Wrapf(err, "failed to write zip entry %s", entryName)
	}
	return nil
}

func (s *APIV1Service) addLocalAttachmentsToZip(ctx context.Context, zipWriter *zip.Writer) (int, int, int, []string) {
	limit := defaultBackupPageSize
	offset := 0
	totalCount := 0
	localCount := 0
	skippedCount := 0
	var skippedReasons []string

	for {
		list, err := s.Store.ListAttachments(ctx, &store.FindAttachment{
			GetBlob:          false,
			SkipDefaultLimit: true,
			Limit:            &limit,
			Offset:           &offset,
		})
		if err != nil {
			slog.Warn("failed to list attachments for backup", "error", err, "offset", offset)
			break
		}
		for _, attachment := range list {
			totalCount++
			if attachment == nil {
				continue
			}
			if attachment.StorageType != storepb.AttachmentStorageType_LOCAL {
				skippedCount++
				addBackupReason(&skippedReasons, fmt.Sprintf("%s: storage not local", attachment.UID), maxBackupAttachmentWarns)
				continue
			}

			localPath, zipEntry, err := resolveLocalAttachmentBackupPath(s.Profile.Data, attachment.Reference)
			if err != nil {
				skippedCount++
				addBackupReason(&skippedReasons, fmt.Sprintf("%s: %v", attachment.UID, err), maxBackupAttachmentWarns)
				continue
			}

			if err := addFileToZip(zipWriter, zipEntry, localPath); err != nil {
				skippedCount++
				addBackupReason(&skippedReasons, fmt.Sprintf("%s: %v", attachment.UID, err), maxBackupAttachmentWarns)
				continue
			}
			localCount++
		}

		if len(list) < limit {
			break
		}
		offset += len(list)
	}

	return totalCount, localCount, skippedCount, skippedReasons
}

func resolveLocalAttachmentBackupPath(dataDir string, reference string) (string, string, error) {
	if strings.TrimSpace(reference) == "" {
		return "", "", errors.New("empty attachment reference")
	}

	dataDirAbs, err := filepath.Abs(dataDir)
	if err != nil {
		return "", "", errors.Wrap(err, "failed to resolve data directory")
	}
	referencePath := filepath.FromSlash(reference)
	localPath := referencePath
	if !filepath.IsAbs(localPath) {
		localPath = filepath.Join(dataDirAbs, localPath)
	}
	localPath, err = filepath.Abs(filepath.Clean(localPath))
	if err != nil {
		return "", "", errors.Wrap(err, "failed to resolve attachment path")
	}

	relativePath, err := filepath.Rel(dataDirAbs, localPath)
	if err != nil {
		return "", "", errors.Wrap(err, "failed to resolve attachment relative path")
	}
	if relativePath == "." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) || relativePath == ".." || filepath.IsAbs(relativePath) {
		return "", "", errors.New("attachment reference is outside data directory")
	}

	return localPath, path.Join("attachments", filepath.ToSlash(relativePath)), nil
}

func writeManifestToZip(zipWriter *zip.Writer, manifestData []byte) error {
	entry, err := zipWriter.Create("backup.manifest.json")
	if err != nil {
		return errors.Wrap(err, "failed to create manifest entry")
	}

	if _, err := entry.Write(manifestData); err != nil {
		return errors.Wrap(err, "failed to write manifest")
	}
	return nil
}

func addBackupReason(reasons *[]string, reason string, maxCount int) {
	if len(*reasons) >= maxCount {
		return
	}
	*reasons = append(*reasons, reason)
}

func resolveBackupDBPath(dsn string) (string, error) {
	base := strings.TrimSpace(dsn)
	if idx := strings.Index(base, "?"); idx != -1 {
		base = base[:idx]
	}
	if base == "" {
		return "", errors.New("empty dsn")
	}
	if strings.HasPrefix(strings.ToLower(base), "file:") {
		base = strings.TrimPrefix(base, "file:")
		base = strings.TrimLeft(base, "/")
	}
	return base, nil
}

func getFileSize(pathName string) (int64, error) {
	stat, err := os.Stat(pathName)
	if err != nil {
		return 0, err
	}
	return stat.Size(), nil
}
