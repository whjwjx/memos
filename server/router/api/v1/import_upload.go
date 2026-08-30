package v1

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/lithammer/shortuuid/v4"
	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/base"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const (
	importUploadChunkSize     int64 = 20 << 20
	maxImportUploadChunkBytes int64 = 32 << 20
	maxImportUploadBytes      int64 = 2 << 30
	importUploadTTL                 = 24 * time.Hour
)

type createImportUploadRequest struct {
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
	Sha256   string `json:"sha256"`
	Source   string `json:"source"`
	Scope    string `json:"scope"`
}

type importUploadResponse struct {
	UploadID       string              `json:"uploadId"`
	ChunkSize      int64               `json:"chunkSize"`
	ChunkCount     int                 `json:"chunkCount"`
	ExpiresAt      string              `json:"expiresAt"`
	UploadedChunks []int               `json:"uploadedChunks,omitempty"`
	Result         *importExportResult `json:"result,omitempty"`
}

type importUploadMetadata struct {
	UploadID   string `json:"uploadId"`
	UserID     int32  `json:"userId"`
	Filename   string `json:"filename"`
	Size       int64  `json:"size"`
	Sha256     string `json:"sha256"`
	Source     string `json:"source"`
	Scope      string `json:"scope"`
	ChunkSize  int64  `json:"chunkSize"`
	ChunkCount int    `json:"chunkCount"`
	CreatedTs  int64  `json:"createdTs"`
	ExpiresTs  int64  `json:"expiresTs"`
}

func (s *APIV1Service) createImportUpload(c *echo.Context, authenticator *auth.Authenticator) error {
	user, err := s.authenticateImportUploadUser(c, authenticator)
	if err != nil {
		return err
	}
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 1<<20)

	var request createImportUploadRequest
	if err := json.NewDecoder(c.Request().Body).Decode(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid upload request").Wrap(err)
	}
	scope, err := parseImportExportScope(request.Scope)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if scope == importExportScopeAll && user.Role != store.RoleAdmin {
		return echo.NewHTTPError(http.StatusForbidden, "permission denied")
	}
	source, err := parseImportSource(request.Source)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if request.Size <= 0 || request.Size > maxImportUploadBytes {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid upload size")
	}
	if request.Sha256 != "" && !isHexSHA256(request.Sha256) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid upload checksum")
	}
	if request.Filename == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "filename is required")
	}

	_ = s.cleanupExpiredImportUploads()

	now := time.Now()
	uploadID := shortuuid.New()
	metadata := &importUploadMetadata{
		UploadID:   uploadID,
		UserID:     user.ID,
		Filename:   filepath.Base(request.Filename),
		Size:       request.Size,
		Sha256:     request.Sha256,
		Source:     string(source),
		Scope:      string(scope),
		ChunkSize:  importUploadChunkSize,
		ChunkCount: int((request.Size + importUploadChunkSize - 1) / importUploadChunkSize),
		CreatedTs:  now.Unix(),
		ExpiresTs:  now.Add(importUploadTTL).Unix(),
	}
	dir, err := s.importUploadSessionDir(uploadID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create upload session").Wrap(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "chunks"), 0755); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create upload session").Wrap(err)
	}
	if err := writeImportUploadMetadata(dir, metadata); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to save upload session").Wrap(err)
	}
	return c.JSON(http.StatusOK, importUploadResponse{
		UploadID:   uploadID,
		ChunkSize:  metadata.ChunkSize,
		ChunkCount: metadata.ChunkCount,
		ExpiresAt:  time.Unix(metadata.ExpiresTs, 0).Format(time.RFC3339),
	})
}

func (s *APIV1Service) uploadImportChunk(c *echo.Context, authenticator *auth.Authenticator) error {
	user, err := s.authenticateImportUploadUser(c, authenticator)
	if err != nil {
		return err
	}
	metadata, dir, err := s.readAuthorizedImportUpload(c.Param("uploadId"), user)
	if err != nil {
		return err
	}
	index, err := strconv.Atoi(c.Param("index"))
	if err != nil || index < 0 || index >= metadata.ChunkCount {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid chunk index")
	}
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, maxImportUploadChunkBytes)

	chunkPath := filepath.Join(dir, "chunks", importUploadChunkName(index))
	tmpPath := chunkPath + ".tmp"
	tmpFile, err := os.Create(tmpPath)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create chunk file").Wrap(err)
	}
	written, copyErr := io.Copy(tmpFile, c.Request().Body)
	closeErr := tmpFile.Close()
	if copyErr != nil {
		_ = os.Remove(tmpPath)
		return echo.NewHTTPError(http.StatusBadRequest, "failed to save chunk").Wrap(copyErr)
	}
	if closeErr != nil {
		_ = os.Remove(tmpPath)
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to close chunk file").Wrap(closeErr)
	}
	if written <= 0 || written > maxImportUploadChunkBytes {
		_ = os.Remove(tmpPath)
		return echo.NewHTTPError(http.StatusBadRequest, "invalid chunk size")
	}
	expectedLastChunkSize := metadata.Size - int64(metadata.ChunkCount-1)*metadata.ChunkSize
	if index < metadata.ChunkCount-1 && written != metadata.ChunkSize {
		_ = os.Remove(tmpPath)
		return echo.NewHTTPError(http.StatusBadRequest, "unexpected chunk size")
	}
	if index == metadata.ChunkCount-1 && written != expectedLastChunkSize {
		_ = os.Remove(tmpPath)
		return echo.NewHTTPError(http.StatusBadRequest, "unexpected final chunk size")
	}
	_ = os.Remove(chunkPath)
	if err := os.Rename(tmpPath, chunkPath); err != nil {
		_ = os.Remove(tmpPath)
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to save chunk").Wrap(err)
	}

	return c.JSON(http.StatusOK, importUploadResponse{
		UploadID:       metadata.UploadID,
		ChunkSize:      metadata.ChunkSize,
		ChunkCount:     metadata.ChunkCount,
		ExpiresAt:      time.Unix(metadata.ExpiresTs, 0).Format(time.RFC3339),
		UploadedChunks: []int{index},
	})
}

func (s *APIV1Service) completeImportUpload(c *echo.Context, authenticator *auth.Authenticator) error {
	ctx := c.Request().Context()
	user, err := s.authenticateImportUploadUser(c, authenticator)
	if err != nil {
		return err
	}
	metadata, dir, err := s.readAuthorizedImportUpload(c.Param("uploadId"), user)
	if err != nil {
		return err
	}

	completePath := filepath.Join(dir, "complete.zip")
	if err := mergeImportUploadChunks(dir, completePath, metadata); err != nil {
		return err
	}
	result, err := s.importZip(ctx, user, importExportScope(metadata.Scope), completePath, importSource(metadata.Source))
	if err != nil {
		return err
	}
	if err := os.RemoveAll(dir); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to clean upload session").Wrap(err)
	}
	return c.JSON(http.StatusOK, importUploadResponse{Result: result})
}

func (s *APIV1Service) cancelImportUpload(c *echo.Context, authenticator *auth.Authenticator) error {
	user, err := s.authenticateImportUploadUser(c, authenticator)
	if err != nil {
		return err
	}
	_, dir, err := s.readAuthorizedImportUpload(c.Param("uploadId"), user)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(dir); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to remove upload session").Wrap(err)
	}
	return c.NoContent(http.StatusNoContent)
}

func (s *APIV1Service) authenticateImportUploadUser(c *echo.Context, authenticator *auth.Authenticator) (*store.User, error) {
	user, err := authenticator.AuthenticateToUser(c.Request().Context(), c.Request().Header.Get(echo.HeaderAuthorization), c.Request().Header.Get("Cookie"))
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "failed authentication").Wrap(err)
	}
	if user == nil {
		return nil, echo.NewHTTPError(http.StatusUnauthorized, "authentication required")
	}
	return user, nil
}

func (s *APIV1Service) readAuthorizedImportUpload(uploadID string, user *store.User) (*importUploadMetadata, string, error) {
	dir, err := s.importUploadSessionDir(uploadID)
	if err != nil {
		return nil, "", echo.NewHTTPError(http.StatusBadRequest, "invalid upload id").Wrap(err)
	}
	metadata, err := readImportUploadMetadata(dir)
	if err != nil {
		return nil, "", echo.NewHTTPError(http.StatusNotFound, "upload session not found").Wrap(err)
	}
	if metadata.UserID != user.ID {
		return nil, "", echo.NewHTTPError(http.StatusForbidden, "permission denied")
	}
	if time.Now().Unix() > metadata.ExpiresTs {
		_ = os.RemoveAll(dir)
		return nil, "", echo.NewHTTPError(http.StatusGone, "upload session expired")
	}
	return metadata, dir, nil
}

func (s *APIV1Service) importUploadRoot() string {
	dataDir := os.TempDir()
	if s.Profile != nil && strings.TrimSpace(s.Profile.Data) != "" {
		dataDir = s.Profile.Data
	}
	return filepath.Join(dataDir, "imports", "uploads")
}

func (s *APIV1Service) importUploadSessionDir(uploadID string) (string, error) {
	if !base.UIDMatcher.MatchString(uploadID) {
		return "", errors.New("invalid upload id")
	}
	root, err := filepath.Abs(s.importUploadRoot())
	if err != nil {
		return "", err
	}
	dir, err := filepath.Abs(filepath.Join(root, uploadID))
	if err != nil {
		return "", err
	}
	if dir != root {
		rel, err := filepath.Rel(root, dir)
		if err != nil {
			return "", err
		}
		if rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return "", errors.New("upload path escapes root")
		}
	}
	return dir, nil
}

func writeImportUploadMetadata(dir string, metadata *importUploadMetadata) error {
	file, err := os.Create(filepath.Join(dir, "metadata.json"))
	if err != nil {
		return err
	}
	defer file.Close()
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	return encoder.Encode(metadata)
}

func readImportUploadMetadata(dir string) (*importUploadMetadata, error) {
	file, err := os.Open(filepath.Join(dir, "metadata.json"))
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var metadata importUploadMetadata
	if err := json.NewDecoder(file).Decode(&metadata); err != nil {
		return nil, err
	}
	return &metadata, nil
}

func mergeImportUploadChunks(dir, outputPath string, metadata *importUploadMetadata) error {
	output, err := os.Create(outputPath)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create upload file").Wrap(err)
	}
	hasher := sha256.New()
	written := int64(0)
	for index := range metadata.ChunkCount {
		chunkPath := filepath.Join(dir, "chunks", importUploadChunkName(index))
		chunk, err := os.Open(chunkPath)
		if err != nil {
			output.Close()
			return echo.NewHTTPError(http.StatusBadRequest, fmt.Sprintf("missing chunk %d", index)).Wrap(err)
		}
		n, copyErr := io.Copy(io.MultiWriter(output, hasher), chunk)
		closeErr := chunk.Close()
		if copyErr != nil {
			output.Close()
			return echo.NewHTTPError(http.StatusBadRequest, "failed to merge chunks").Wrap(copyErr)
		}
		if closeErr != nil {
			output.Close()
			return echo.NewHTTPError(http.StatusBadRequest, "failed to read chunk").Wrap(closeErr)
		}
		written += n
	}
	if err := output.Close(); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to close upload file").Wrap(err)
	}
	if written != metadata.Size {
		return echo.NewHTTPError(http.StatusBadRequest, "merged upload size mismatch")
	}
	if metadata.Sha256 != "" && !strings.EqualFold(metadata.Sha256, hex.EncodeToString(hasher.Sum(nil))) {
		return echo.NewHTTPError(http.StatusBadRequest, "merged upload checksum mismatch")
	}
	return nil
}

func importUploadChunkName(index int) string {
	return fmt.Sprintf("%06d.part", index)
}

func isHexSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func (s *APIV1Service) cleanupExpiredImportUploads() error {
	root := s.importUploadRoot()
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	now := time.Now().Unix()
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir, err := s.importUploadSessionDir(entry.Name())
		if err != nil {
			continue
		}
		metadata, err := readImportUploadMetadata(dir)
		if err != nil || metadata.ExpiresTs < now {
			_ = os.RemoveAll(dir)
		}
	}
	return nil
}
