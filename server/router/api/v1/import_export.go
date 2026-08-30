package v1

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"github.com/pkg/errors"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/server/runner/memopayload"
	"github.com/usememos/memos/store"
)

const (
	importExportFormat      = "memos-export"
	importExportVersion     = 1
	importExportPageSize    = 1000
	maxImportExportWarnings = 30
)

type importSource string

const (
	importSourceAuto  importSource = ""
	importSourceMemos importSource = "memos"
	importSourceFlomo importSource = "flomo"
)

type importExportScope string

const (
	importExportScopeMine importExportScope = "mine"
	importExportScopeAll  importExportScope = "all"
)

type importExportManifest struct {
	Format         string                   `json:"format"`
	Version        int                      `json:"version"`
	Scope          string                   `json:"scope"`
	SourceInstance string                   `json:"sourceInstance,omitempty"`
	ExportedAt     string                   `json:"exportedAt"`
	ExportedBy     string                   `json:"exportedBy"`
	Counts         importExportCounts       `json:"counts"`
	Warnings       []string                 `json:"warnings,omitempty"`
	Capabilities   importExportCapabilities `json:"capabilities"`
}

type importExportCapabilities struct {
	Memos       bool `json:"memos"`
	Attachments bool `json:"attachments"`
	Relations   bool `json:"relations"`
	Reactions   bool `json:"reactions"`
	Users       bool `json:"users"`
}

type importExportCounts struct {
	Users       int `json:"users"`
	Memos       int `json:"memos"`
	Attachments int `json:"attachments"`
	Relations   int `json:"relations"`
	Reactions   int `json:"reactions"`
	Skipped     int `json:"skipped"`
}

type importExportUserRecord struct {
	ID          int32  `json:"id,omitempty"`
	Username    string `json:"username"`
	Role        string `json:"role"`
	Email       string `json:"email,omitempty"`
	Nickname    string `json:"nickname,omitempty"`
	AvatarURL   string `json:"avatarUrl,omitempty"`
	Description string `json:"description,omitempty"`
	RowStatus   string `json:"rowStatus"`
	CreatedTs   int64  `json:"createdTs"`
	UpdatedTs   int64  `json:"updatedTs"`
}

type importExportMemoRecord struct {
	UID                 string                        `json:"uid"`
	CreatorUsername     string                        `json:"creatorUsername"`
	CreatedTs           int64                         `json:"createdTs"`
	UpdatedTs           int64                         `json:"updatedTs"`
	RowStatus           string                        `json:"rowStatus"`
	Content             string                        `json:"content"`
	Visibility          string                        `json:"visibility"`
	Pinned              bool                          `json:"pinned"`
	Payload             json.RawMessage               `json:"payload,omitempty"`
	ScheduledTime       *int64                        `json:"scheduledTime,omitempty"`
	ScheduledDuration   *int64                        `json:"scheduledDuration,omitempty"`
	ScheduledRecurrence *store.MemoScheduleRecurrence `json:"scheduledRecurrence,omitempty"`
}

type importExportAttachmentRecord struct {
	UID             string          `json:"uid"`
	CreatorUsername string          `json:"creatorUsername"`
	CreatedTs       int64           `json:"createdTs"`
	UpdatedTs       int64           `json:"updatedTs"`
	Filename        string          `json:"filename"`
	Type            string          `json:"type"`
	Size            int64           `json:"size"`
	MemoUID         string          `json:"memoUid,omitempty"`
	Payload         json.RawMessage `json:"payload,omitempty"`
	ContentPath     string          `json:"contentPath,omitempty"`
	Sha256          string          `json:"sha256,omitempty"`
}

type importExportRelationRecord struct {
	MemoUID        string `json:"memoUid"`
	RelatedMemoUID string `json:"relatedMemoUid"`
	Type           string `json:"type"`
}

type importExportReactionRecord struct {
	CreatorUsername string `json:"creatorUsername"`
	MemoUID         string `json:"memoUid"`
	ReactionType    string `json:"reactionType"`
	CreatedTs       int64  `json:"createdTs"`
}

type importExportResult struct {
	Source             string   `json:"source,omitempty"`
	Scope              string   `json:"scope"`
	CreatedMemos       int      `json:"createdMemos"`
	SkippedMemos       int      `json:"skippedMemos"`
	CreatedAttachments int      `json:"createdAttachments"`
	SkippedAttachments int      `json:"skippedAttachments"`
	CreatedRelations   int      `json:"createdRelations"`
	SkippedRelations   int      `json:"skippedRelations"`
	CreatedReactions   int      `json:"createdReactions"`
	SkippedReactions   int      `json:"skippedReactions"`
	Warnings           []string `json:"warnings,omitempty"`
}

// RegisterImportExportRoutes registers structured user/admin import and export routes.
func (s *APIV1Service) RegisterImportExportRoutes(echoServer *echo.Echo) {
	authenticator := auth.NewAuthenticator(s.Store, s.Secret)
	apiGroup := echoServer.Group("/api/v1")
	apiGroup.GET("/export:download", func(c *echo.Context) error {
		return s.exportStructuredData(c, authenticator)
	})
	apiGroup.POST("/import", func(c *echo.Context) error {
		return s.importStructuredData(c, authenticator)
	})
	apiGroup.POST("/import/uploads", func(c *echo.Context) error {
		return s.createImportUpload(c, authenticator)
	})
	apiGroup.PUT("/import/uploads/:uploadId/chunks/:index", func(c *echo.Context) error {
		return s.uploadImportChunk(c, authenticator)
	})
	apiGroup.POST("/import/uploads/:uploadId/complete", func(c *echo.Context) error {
		return s.completeImportUpload(c, authenticator)
	})
	apiGroup.DELETE("/import/uploads/:uploadId", func(c *echo.Context) error {
		return s.cancelImportUpload(c, authenticator)
	})
}

func (s *APIV1Service) exportStructuredData(c *echo.Context, authenticator *auth.Authenticator) error {
	ctx := c.Request().Context()
	user, scope, err := s.authenticateImportExportRequest(ctx, c, authenticator)
	if err != nil {
		return err
	}

	tmpDir, err := os.MkdirTemp("", "memos-export-")
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create temporary directory").Wrap(err)
	}
	defer os.RemoveAll(tmpDir)

	exportFilename := fmt.Sprintf("memos-export-%s-%s.zip", scope, time.Now().Format("20060102-150405"))
	zipFilePath := filepath.Join(tmpDir, exportFilename)

	manifest, err := s.createStructuredExportZip(ctx, user, scope, zipFilePath)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create export zip").Wrap(err)
	}
	zipSize, err := getFileSize(zipFilePath)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to read export zip").Wrap(err)
	}

	c.Response().Header().Set(echo.HeaderContentType, "application/zip")
	c.Response().Header().Set(echo.HeaderContentDisposition, fmt.Sprintf(`attachment; filename="%s"`, exportFilename))
	c.Response().Header().Set(echo.HeaderContentLength, strconv.FormatInt(zipSize, 10))
	c.Response().Header().Set("Cache-Control", "no-store")
	c.Response().WriteHeader(http.StatusOK)

	slog.Info("memos structured export created",
		"username", user.Username,
		"scope", scope,
		"filename", exportFilename,
		"bytes", zipSize,
		"memos", manifest.Counts.Memos,
		"attachments", manifest.Counts.Attachments,
	)

	zipFile, err := os.Open(zipFilePath)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to open export file").Wrap(err)
	}
	defer zipFile.Close()
	if _, err := io.Copy(c.Response(), zipFile); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to write export file").Wrap(err)
	}
	return nil
}

func (s *APIV1Service) importStructuredData(c *echo.Context, authenticator *auth.Authenticator) error {
	ctx := c.Request().Context()
	user, scope, err := s.authenticateImportExportRequest(ctx, c, authenticator)
	if err != nil {
		return err
	}
	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, MaxAPIRequestBytes)

	fileHeader, err := c.FormFile("file")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "import file is required").Wrap(err)
	}
	if fileHeader.Size > MaxAPIRequestBytes {
		return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "import file is too large")
	}
	source, err := parseImportSource(c.QueryParam("source"))
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	upload, err := fileHeader.Open()
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "failed to open import file").Wrap(err)
	}
	defer upload.Close()

	tmpFile, err := os.CreateTemp("", "memos-import-*.zip")
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create temporary import file").Wrap(err)
	}
	tmpFilePath := tmpFile.Name()
	defer os.Remove(tmpFilePath)
	if _, err := io.Copy(tmpFile, upload); err != nil {
		tmpFile.Close()
		return echo.NewHTTPError(http.StatusBadRequest, "failed to save import file").Wrap(err)
	}
	if err := tmpFile.Close(); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to close import file").Wrap(err)
	}

	result, err := s.importZip(ctx, user, scope, tmpFilePath, source)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, result)
}

func parseImportSource(raw string) (importSource, error) {
	source := importSource(strings.TrimSpace(strings.ToLower(raw)))
	switch source {
	case importSourceAuto, importSourceMemos, importSourceFlomo:
		return source, nil
	default:
		return "", errors.Errorf("unsupported import source %q", raw)
	}
}

func (s *APIV1Service) authenticateImportExportRequest(ctx context.Context, c *echo.Context, authenticator *auth.Authenticator) (*store.User, importExportScope, error) {
	user, err := authenticator.AuthenticateToUser(ctx, c.Request().Header.Get(echo.HeaderAuthorization), c.Request().Header.Get("Cookie"))
	if err != nil {
		return nil, "", echo.NewHTTPError(http.StatusUnauthorized, "failed authentication").Wrap(err)
	}
	if user == nil {
		return nil, "", echo.NewHTTPError(http.StatusUnauthorized, "authentication required")
	}

	scope, err := parseImportExportScope(c.QueryParam("scope"))
	if err != nil {
		return nil, "", echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if scope == importExportScopeAll && user.Role != store.RoleAdmin {
		return nil, "", echo.NewHTTPError(http.StatusForbidden, "permission denied")
	}
	return user, scope, nil
}

func parseImportExportScope(raw string) (importExportScope, error) {
	scope := importExportScope(strings.TrimSpace(strings.ToLower(raw)))
	if scope == "" {
		return importExportScopeMine, nil
	}
	switch scope {
	case importExportScopeMine, importExportScopeAll:
		return scope, nil
	default:
		return "", errors.Errorf("unsupported scope %q", raw)
	}
}

func (s *APIV1Service) importZip(ctx context.Context, user *store.User, scope importExportScope, zipFilePath string, source importSource) (*importExportResult, error) {
	zipReader, err := zip.OpenReader(zipFilePath)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "invalid import zip").Wrap(err)
	}
	defer zipReader.Close()

	if findZipEntry(&zipReader.Reader, "manifest.json") != nil {
		if source == importSourceFlomo {
			return nil, echo.NewHTTPError(http.StatusBadRequest, "selected flomo import but uploaded a Memos data package")
		}
		return s.importStructuredZip(ctx, user, scope, zipFilePath)
	}

	flomoHTML := findFlomoHTMLZipEntry(&zipReader.Reader)
	if flomoHTML != nil {
		if source == importSourceMemos {
			return nil, echo.NewHTTPError(http.StatusBadRequest, "selected Memos import but uploaded a flomo data package")
		}
		if scope != importExportScopeMine {
			return nil, echo.NewHTTPError(http.StatusBadRequest, "flomo import only supports scope=mine")
		}
		return s.importFlomoZip(ctx, user, scope, zipFilePath, flomoHTML.Name)
	}

	return nil, echo.NewHTTPError(http.StatusBadRequest, "unsupported import format")
}

func (s *APIV1Service) createStructuredExportZip(ctx context.Context, user *store.User, scope importExportScope, zipFilePath string) (*importExportManifest, error) {
	zipFile, err := os.Create(zipFilePath)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create zip file")
	}
	defer zipFile.Close()

	zipWriter := zip.NewWriter(zipFile)
	defer zipWriter.Close()

	users, err := s.listExportUsers(ctx, user, scope)
	if err != nil {
		return nil, err
	}
	if err := writeJSONLToZip(zipWriter, "users.jsonl", users); err != nil {
		return nil, err
	}

	memos, err := s.listExportMemos(ctx, user, scope)
	if err != nil {
		return nil, err
	}
	memoIDToUID := make(map[int32]string, len(memos))
	for _, memo := range memos {
		memoIDToUID[memo.ID] = memo.UID
	}

	memoRecords, err := s.buildExportMemoRecords(ctx, memos)
	if err != nil {
		return nil, err
	}
	if err := writeJSONLToZip(zipWriter, "memos.jsonl", memoRecords); err != nil {
		return nil, err
	}

	var warnings []string
	attachmentRecords, skippedAttachments, err := s.writeExportAttachments(ctx, zipWriter, user, scope, memoIDToUID, &warnings)
	if err != nil {
		return nil, err
	}
	if err := writeJSONLToZip(zipWriter, "attachments.jsonl", attachmentRecords); err != nil {
		return nil, err
	}

	relationRecords, err := s.buildExportRelationRecords(ctx, memoIDToUID)
	if err != nil {
		return nil, err
	}
	if err := writeJSONLToZip(zipWriter, "memo_relations.jsonl", relationRecords); err != nil {
		return nil, err
	}

	reactionRecords, err := s.buildExportReactionRecords(ctx, user, scope, memoIDToUID)
	if err != nil {
		return nil, err
	}
	if err := writeJSONLToZip(zipWriter, "reactions.jsonl", reactionRecords); err != nil {
		return nil, err
	}

	manifest := &importExportManifest{
		Format:         importExportFormat,
		Version:        importExportVersion,
		Scope:          string(scope),
		SourceInstance: strings.TrimSpace(s.Profile.InstanceURL),
		ExportedAt:     time.Now().Format(time.RFC3339),
		ExportedBy:     user.Username,
		Counts: importExportCounts{
			Users:       len(users),
			Memos:       len(memoRecords),
			Attachments: len(attachmentRecords),
			Relations:   len(relationRecords),
			Reactions:   len(reactionRecords),
			Skipped:     skippedAttachments,
		},
		Warnings: warnings,
		Capabilities: importExportCapabilities{
			Memos:       true,
			Attachments: true,
			Relations:   true,
			Reactions:   true,
			Users:       true,
		},
	}
	if err := writeJSONToZip(zipWriter, "manifest.json", manifest); err != nil {
		return nil, err
	}
	return manifest, nil
}

func (s *APIV1Service) listExportUsers(ctx context.Context, user *store.User, scope importExportScope) ([]*importExportUserRecord, error) {
	users := []*store.User{user}
	if scope == importExportScopeAll {
		var err error
		users, err = s.Store.ListUsers(ctx, &store.FindUser{})
		if err != nil {
			return nil, errors.Wrap(err, "failed to list users")
		}
	}
	records := make([]*importExportUserRecord, 0, len(users))
	for _, u := range users {
		if u == nil {
			continue
		}
		records = append(records, &importExportUserRecord{
			ID:          u.ID,
			Username:    u.Username,
			Role:        u.Role.String(),
			Email:       u.Email,
			Nickname:    u.Nickname,
			AvatarURL:   u.AvatarURL,
			Description: u.Description,
			RowStatus:   u.RowStatus.String(),
			CreatedTs:   u.CreatedTs,
			UpdatedTs:   u.UpdatedTs,
		})
	}
	sort.Slice(records, func(i, j int) bool {
		return records[i].Username < records[j].Username
	})
	return records, nil
}

func (s *APIV1Service) listExportMemos(ctx context.Context, user *store.User, scope importExportScope) ([]*store.Memo, error) {
	limit := importExportPageSize
	offset := 0
	memos := []*store.Memo{}
	for {
		find := &store.FindMemo{
			Limit:          &limit,
			Offset:         &offset,
			OrderByTimeAsc: true,
		}
		if scope == importExportScopeMine {
			find.CreatorID = &user.ID
		}
		list, err := s.Store.ListMemos(ctx, find)
		if err != nil {
			return nil, errors.Wrap(err, "failed to list memos")
		}
		memos = append(memos, list...)
		if len(list) < limit {
			break
		}
		offset += len(list)
	}
	sort.SliceStable(memos, func(i, j int) bool {
		if memos[i].CreatedTs == memos[j].CreatedTs {
			return memos[i].ID < memos[j].ID
		}
		return memos[i].CreatedTs < memos[j].CreatedTs
	})
	return memos, nil
}

func (s *APIV1Service) buildExportMemoRecords(ctx context.Context, memos []*store.Memo) ([]*importExportMemoRecord, error) {
	creatorIDs := make([]int32, 0, len(memos))
	for _, memo := range memos {
		creatorIDs = append(creatorIDs, memo.CreatorID)
	}
	creatorMap, err := s.listUsersByID(ctx, creatorIDs)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list memo creators")
	}

	records := make([]*importExportMemoRecord, 0, len(memos))
	for _, memo := range memos {
		creator := creatorMap[memo.CreatorID]
		if creator == nil {
			continue
		}
		payload, err := marshalProtoJSON(memo.Payload)
		if err != nil {
			return nil, errors.Wrap(err, "failed to marshal memo payload")
		}
		records = append(records, &importExportMemoRecord{
			UID:                 memo.UID,
			CreatorUsername:     creator.Username,
			CreatedTs:           memo.CreatedTs,
			UpdatedTs:           memo.UpdatedTs,
			RowStatus:           memo.RowStatus.String(),
			Content:             memo.Content,
			Visibility:          memo.Visibility.String(),
			Pinned:              memo.Pinned,
			Payload:             payload,
			ScheduledTime:       memo.ScheduledTime,
			ScheduledDuration:   memo.ScheduledDuration,
			ScheduledRecurrence: memo.ScheduledRecurrence,
		})
	}
	return records, nil
}

func (s *APIV1Service) writeExportAttachments(
	ctx context.Context,
	zipWriter *zip.Writer,
	user *store.User,
	scope importExportScope,
	memoIDToUID map[int32]string,
	warnings *[]string,
) ([]*importExportAttachmentRecord, int, error) {
	limit := importExportPageSize
	offset := 0
	records := []*importExportAttachmentRecord{}
	skipped := 0

	for {
		find := &store.FindAttachment{
			SkipDefaultLimit: true,
			Limit:            &limit,
			Offset:           &offset,
		}
		if scope == importExportScopeMine {
			find.CreatorID = &user.ID
		}
		attachments, err := s.Store.ListAttachments(ctx, find)
		if err != nil {
			return nil, 0, errors.Wrap(err, "failed to list attachments")
		}
		for _, attachment := range attachments {
			if attachment == nil {
				continue
			}
			memoUID := ""
			if attachment.MemoID != nil {
				var ok bool
				memoUID, ok = memoIDToUID[*attachment.MemoID]
				if !ok {
					continue
				}
			}
			if attachment.StorageType == storepb.AttachmentStorageType_EXTERNAL {
				skipped++
				addImportExportWarning(warnings, fmt.Sprintf("%s: external attachment skipped", attachment.UID))
				continue
			}
			blob, err := s.GetAttachmentBlob(ctx, attachment)
			if err != nil {
				skipped++
				addImportExportWarning(warnings, fmt.Sprintf("%s: failed to read attachment: %v", attachment.UID, err))
				continue
			}
			if len(blob) == 0 && attachment.Size > 0 {
				skipped++
				addImportExportWarning(warnings, fmt.Sprintf("%s: empty attachment content", attachment.UID))
				continue
			}
			if !validateFilename(attachment.Filename) {
				skipped++
				addImportExportWarning(warnings, fmt.Sprintf("%s: invalid attachment filename", attachment.UID))
				continue
			}
			contentPath := path.Join("attachments", attachment.UID, attachment.Filename)
			entry, err := zipWriter.Create(contentPath)
			if err != nil {
				return nil, 0, errors.Wrap(err, "failed to create attachment zip entry")
			}
			if _, err := entry.Write(blob); err != nil {
				return nil, 0, errors.Wrap(err, "failed to write attachment zip entry")
			}
			payload, err := marshalProtoJSON(sanitizeAttachmentPayload(attachment.Payload))
			if err != nil {
				return nil, 0, errors.Wrap(err, "failed to marshal attachment payload")
			}
			sum := sha256.Sum256(blob)
			records = append(records, &importExportAttachmentRecord{
				UID:             attachment.UID,
				CreatorUsername: user.Username,
				CreatedTs:       attachment.CreatedTs,
				UpdatedTs:       attachment.UpdatedTs,
				Filename:        attachment.Filename,
				Type:            attachment.Type,
				Size:            int64(len(blob)),
				MemoUID:         memoUID,
				Payload:         payload,
				ContentPath:     contentPath,
				Sha256:          hex.EncodeToString(sum[:]),
			})
		}
		if len(attachments) < limit {
			break
		}
		offset += len(attachments)
	}

	if scope == importExportScopeAll {
		if err := s.fillAttachmentCreatorUsernames(ctx, records); err != nil {
			return nil, 0, err
		}
	}
	sort.SliceStable(records, func(i, j int) bool {
		if records[i].CreatedTs == records[j].CreatedTs {
			return records[i].UID < records[j].UID
		}
		return records[i].CreatedTs < records[j].CreatedTs
	})
	return records, skipped, nil
}

func (s *APIV1Service) fillAttachmentCreatorUsernames(ctx context.Context, records []*importExportAttachmentRecord) error {
	if len(records) == 0 {
		return nil
	}
	attachmentsByUID := make(map[string]*store.Attachment, len(records))
	for _, record := range records {
		uid := record.UID
		attachment, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &uid})
		if err != nil {
			return errors.Wrap(err, "failed to get attachment creator")
		}
		if attachment != nil {
			attachmentsByUID[uid] = attachment
		}
	}
	creatorIDs := make([]int32, 0, len(attachmentsByUID))
	for _, attachment := range attachmentsByUID {
		creatorIDs = append(creatorIDs, attachment.CreatorID)
	}
	creatorMap, err := s.listUsersByID(ctx, creatorIDs)
	if err != nil {
		return errors.Wrap(err, "failed to list attachment creators")
	}
	for _, record := range records {
		attachment := attachmentsByUID[record.UID]
		if attachment == nil {
			continue
		}
		creator := creatorMap[attachment.CreatorID]
		if creator != nil {
			record.CreatorUsername = creator.Username
		}
	}
	return nil
}

func (s *APIV1Service) buildExportRelationRecords(ctx context.Context, memoIDToUID map[int32]string) ([]*importExportRelationRecord, error) {
	if len(memoIDToUID) == 0 {
		return []*importExportRelationRecord{}, nil
	}
	memoIDs := make([]int32, 0, len(memoIDToUID))
	for memoID := range memoIDToUID {
		memoIDs = append(memoIDs, memoID)
	}
	relations, err := s.Store.ListMemoRelations(ctx, &store.FindMemoRelation{SourceMemoIDList: memoIDs})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list memo relations")
	}
	records := make([]*importExportRelationRecord, 0, len(relations))
	for _, relation := range relations {
		memoUID, memoOK := memoIDToUID[relation.MemoID]
		relatedMemoUID, relatedOK := memoIDToUID[relation.RelatedMemoID]
		if !memoOK || !relatedOK {
			continue
		}
		records = append(records, &importExportRelationRecord{
			MemoUID:        memoUID,
			RelatedMemoUID: relatedMemoUID,
			Type:           string(relation.Type),
		})
	}
	sort.SliceStable(records, func(i, j int) bool {
		if records[i].MemoUID == records[j].MemoUID {
			if records[i].RelatedMemoUID == records[j].RelatedMemoUID {
				return records[i].Type < records[j].Type
			}
			return records[i].RelatedMemoUID < records[j].RelatedMemoUID
		}
		return records[i].MemoUID < records[j].MemoUID
	})
	return records, nil
}

func (s *APIV1Service) buildExportReactionRecords(ctx context.Context, user *store.User, scope importExportScope, memoIDToUID map[int32]string) ([]*importExportReactionRecord, error) {
	if len(memoIDToUID) == 0 {
		return []*importExportReactionRecord{}, nil
	}
	memoIDs := make([]int32, 0, len(memoIDToUID))
	for memoID := range memoIDToUID {
		memoIDs = append(memoIDs, memoID)
	}
	find := &store.FindReaction{MemoIDList: memoIDs}
	if scope == importExportScopeMine {
		find.CreatorID = &user.ID
	}
	reactions, err := s.Store.ListReactions(ctx, find)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list reactions")
	}
	creatorIDs := make([]int32, 0, len(reactions))
	for _, reaction := range reactions {
		creatorIDs = append(creatorIDs, reaction.CreatorID)
	}
	creatorMap, err := s.listUsersByID(ctx, creatorIDs)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list reaction creators")
	}

	records := make([]*importExportReactionRecord, 0, len(reactions))
	for _, reaction := range reactions {
		memoUID, ok := memoIDToUID[reaction.MemoID]
		if !ok {
			continue
		}
		creator := creatorMap[reaction.CreatorID]
		if creator == nil {
			continue
		}
		records = append(records, &importExportReactionRecord{
			CreatorUsername: creator.Username,
			MemoUID:         memoUID,
			ReactionType:    reaction.ReactionType,
			CreatedTs:       reaction.CreatedTs,
		})
	}
	sort.SliceStable(records, func(i, j int) bool {
		if records[i].MemoUID == records[j].MemoUID {
			if records[i].CreatorUsername == records[j].CreatorUsername {
				return records[i].ReactionType < records[j].ReactionType
			}
			return records[i].CreatorUsername < records[j].CreatorUsername
		}
		return records[i].MemoUID < records[j].MemoUID
	})
	return records, nil
}

func (s *APIV1Service) importStructuredZip(ctx context.Context, user *store.User, scope importExportScope, zipFilePath string) (*importExportResult, error) {
	zipReader, err := zip.OpenReader(zipFilePath)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "invalid import zip").Wrap(err)
	}
	defer zipReader.Close()

	manifest, err := readJSONFromZip[importExportManifest](&zipReader.Reader, "manifest.json")
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "invalid import manifest").Wrap(err)
	}
	if manifest.Format != importExportFormat || manifest.Version != importExportVersion {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "unsupported import format")
	}

	result := &importExportResult{Source: string(importSourceMemos), Scope: string(scope)}
	zipEntries := zipEntriesByName(&zipReader.Reader)
	userIDs, err := s.resolveImportUsers(ctx, user, scope)
	if err != nil {
		return nil, err
	}
	uidMapper := newImportUIDMapper(user, scope)
	memoRecords, err := readJSONLFromZip[importExportMemoRecord](&zipReader.Reader, "memos.jsonl")
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "invalid memos.jsonl").Wrap(err)
	}
	attachmentRecords, err := readJSONLFromZip[importExportAttachmentRecord](&zipReader.Reader, "attachments.jsonl")
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusBadRequest, "invalid attachments.jsonl").Wrap(err)
	}
	attachmentUIDMap, err := s.buildImportAttachmentUIDMap(ctx, attachmentRecords, userIDs, scope, uidMapper)
	if err != nil {
		return nil, err
	}
	memoIDsByUID, err := s.importMemosFromRecords(ctx, memoRecords, userIDs, scope, uidMapper, attachmentUIDMap, result)
	if err != nil {
		return nil, err
	}
	if err := s.importAttachmentsFromZip(ctx, zipEntries, attachmentRecords, userIDs, scope, uidMapper, memoIDsByUID, result); err != nil {
		return nil, err
	}
	if err := s.importRelationsFromZip(ctx, &zipReader.Reader, memoIDsByUID, result); err != nil {
		return nil, err
	}
	if err := s.importReactionsFromZip(ctx, &zipReader.Reader, userIDs, scope, memoIDsByUID, result); err != nil {
		return nil, err
	}
	return result, nil
}

type importUIDMapper struct {
	scope importExportScope
	user  *store.User
}

func newImportUIDMapper(user *store.User, scope importExportScope) *importUIDMapper {
	return &importUIDMapper{
		scope: scope,
		user:  user,
	}
}

func (m *importUIDMapper) memoUID(originalUID string) string {
	if m == nil || m.scope == importExportScopeAll {
		return originalUID
	}
	return stableImportUID("memo", importOwnerUIDScope(m.user), originalUID)
}

func (m *importUIDMapper) attachmentUID(originalUID string) string {
	if m == nil || m.scope == importExportScopeAll {
		return originalUID
	}
	return stableImportUID("att", importOwnerUIDScope(m.user), originalUID)
}

func importOwnerUIDScope(user *store.User) string {
	if user == nil {
		return ""
	}
	return fmt.Sprintf("user:%d", user.ID)
}

func (s *APIV1Service) resolveImportMemoUID(
	ctx context.Context,
	originalUID string,
	creatorID int32,
	scope importExportScope,
	uidMapper *importUIDMapper,
) (string, *store.Memo, error) {
	targetUID := originalUID
	if uidMapper != nil {
		targetUID = uidMapper.memoUID(originalUID)
	}
	if scope == importExportScopeAll || targetUID == originalUID {
		existing, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &originalUID})
		return targetUID, existing, err
	}

	existingOriginal, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &originalUID})
	if err != nil {
		return "", nil, err
	}
	if existingOriginal != nil && existingOriginal.CreatorID == creatorID {
		return originalUID, existingOriginal, nil
	}

	existingTarget, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &targetUID})
	if err != nil {
		return "", nil, err
	}
	return targetUID, existingTarget, nil
}

func (s *APIV1Service) resolveImportAttachmentUID(
	ctx context.Context,
	originalUID string,
	creatorID int32,
	scope importExportScope,
	uidMapper *importUIDMapper,
) (string, *store.Attachment, error) {
	targetUID := originalUID
	if uidMapper != nil {
		targetUID = uidMapper.attachmentUID(originalUID)
	}
	if scope == importExportScopeAll || targetUID == originalUID {
		existing, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &originalUID})
		return targetUID, existing, err
	}

	existingOriginal, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &originalUID})
	if err != nil {
		return "", nil, err
	}
	if existingOriginal != nil && existingOriginal.CreatorID == creatorID {
		return originalUID, existingOriginal, nil
	}

	existingTarget, err := s.Store.GetAttachment(ctx, &store.FindAttachment{UID: &targetUID})
	if err != nil {
		return "", nil, err
	}
	return targetUID, existingTarget, nil
}

func (s *APIV1Service) buildImportAttachmentUIDMap(
	ctx context.Context,
	records []importExportAttachmentRecord,
	userIDs map[string]int32,
	scope importExportScope,
	uidMapper *importUIDMapper,
) (map[string]string, error) {
	uidMap := make(map[string]string, len(records))
	for _, record := range records {
		creatorID, ok := importCreatorID(userIDs, record.CreatorUsername, scope)
		if !ok {
			continue
		}
		targetUID, _, err := s.resolveImportAttachmentUID(ctx, record.UID, creatorID, scope, uidMapper)
		if err != nil {
			return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to get attachment").Wrap(err)
		}
		uidMap[record.UID] = targetUID
	}
	return uidMap, nil
}

func (s *APIV1Service) resolveImportUsers(ctx context.Context, user *store.User, scope importExportScope) (map[string]int32, error) {
	userIDs := map[string]int32{
		user.Username: user.ID,
		"":            user.ID,
	}
	if scope == importExportScopeMine {
		return userIDs, nil
	}
	users, err := s.Store.ListUsers(ctx, &store.FindUser{})
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to list users").Wrap(err)
	}
	for _, existing := range users {
		userIDs[existing.Username] = existing.ID
	}
	return userIDs, nil
}

func (s *APIV1Service) importMemosFromRecords(
	ctx context.Context,
	records []importExportMemoRecord,
	userIDs map[string]int32,
	scope importExportScope,
	uidMapper *importUIDMapper,
	attachmentUIDMap map[string]string,
	result *importExportResult,
) (map[string]int32, error) {
	memoIDsByUID := make(map[string]int32, len(records))
	for _, record := range records {
		creatorID, ok := importCreatorID(userIDs, record.CreatorUsername, scope)
		if !ok {
			result.SkippedMemos++
			addImportExportWarning(&result.Warnings, fmt.Sprintf("%s: creator %q not found", record.UID, record.CreatorUsername))
			continue
		}
		targetUID, existing, err := s.resolveImportMemoUID(ctx, record.UID, creatorID, scope, uidMapper)
		if err != nil {
			return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to get memo").Wrap(err)
		}
		if existing != nil {
			if scope == importExportScopeMine && existing.CreatorID != creatorID {
				result.SkippedMemos++
				addImportExportWarning(&result.Warnings, fmt.Sprintf("%s: memo UID already belongs to another user", targetUID))
				continue
			}
			memoIDsByUID[record.UID] = existing.ID
			result.SkippedMemos++
			continue
		}

		payload, err := unmarshalMemoPayload(record.Payload)
		if err != nil {
			return nil, echo.NewHTTPError(http.StatusBadRequest, "invalid memo payload").Wrap(err)
		}
		content := rewriteImportedAttachmentLinks(record.Content, attachmentUIDMap)
		create := &store.Memo{
			UID:                 targetUID,
			CreatorID:           creatorID,
			CreatedTs:           record.CreatedTs,
			UpdatedTs:           record.UpdatedTs,
			Content:             content,
			Visibility:          importVisibility(record.Visibility),
			Payload:             payload,
			ScheduledTime:       record.ScheduledTime,
			ScheduledDuration:   record.ScheduledDuration,
			ScheduledRecurrence: record.ScheduledRecurrence,
		}
		if create.Payload == nil || content != record.Content {
			if err := memopayload.RebuildMemoPayload(ctx, create, s.MarkdownService); err != nil {
				return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to rebuild memo payload").Wrap(err)
			}
		}
		memo, err := s.Store.CreateMemo(ctx, create)
		if err != nil {
			if isUniqueConstraintError(err) {
				result.SkippedMemos++
				continue
			}
			return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to create memo").Wrap(err)
		}
		update := &store.UpdateMemo{ID: memo.ID}
		if record.Pinned {
			update.Pinned = &record.Pinned
		}
		if rowStatus := importRowStatus(record.RowStatus); rowStatus != store.Normal {
			update.RowStatus = &rowStatus
		}
		if update.Pinned != nil || update.RowStatus != nil {
			if err := s.Store.UpdateMemo(ctx, update); err != nil {
				return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to update imported memo").Wrap(err)
			}
		}
		memoIDsByUID[record.UID] = memo.ID
		result.CreatedMemos++
	}
	return memoIDsByUID, nil
}

func rewriteImportedAttachmentLinks(content string, attachmentUIDMap map[string]string) string {
	if len(attachmentUIDMap) == 0 || !strings.Contains(content, "/file/attachments/") {
		return content
	}

	const prefix = "/file/attachments/"
	var builder strings.Builder
	builder.Grow(len(content))
	cursor := 0
	for {
		index := strings.Index(content[cursor:], prefix)
		if index < 0 {
			builder.WriteString(content[cursor:])
			break
		}
		index += cursor
		if !isImportAttachmentPrefixBoundary(content, index) {
			builder.WriteString(content[cursor : index+len(prefix)])
			cursor = index + len(prefix)
			continue
		}
		uidStart := index + len(prefix)
		uidEnd := uidStart
		for uidEnd < len(content) && isImportUIDByte(content[uidEnd]) {
			uidEnd++
		}
		if uidEnd == uidStart {
			builder.WriteString(content[cursor:uidEnd])
			cursor = uidEnd
			continue
		}

		uid := content[uidStart:uidEnd]
		targetUID := attachmentUIDMap[uid]
		if targetUID == "" {
			targetUID = uid
		}
		builder.WriteString(content[cursor:uidStart])
		builder.WriteString(targetUID)
		cursor = uidEnd
	}
	return builder.String()
}

func isImportUIDByte(value byte) bool {
	return value >= 'a' && value <= 'z' || value >= 'A' && value <= 'Z' || value >= '0' && value <= '9' || value == '-'
}

func isImportAttachmentPrefixBoundary(content string, index int) bool {
	if index == 0 {
		return true
	}
	switch content[index-1] {
	case ' ', '\t', '\r', '\n', '(', '[', '"', '\'', '<', '=':
		return true
	default:
		return false
	}
}

func (s *APIV1Service) importAttachmentsFromZip(
	ctx context.Context,
	zipEntries map[string]*zip.File,
	records []importExportAttachmentRecord,
	userIDs map[string]int32,
	scope importExportScope,
	uidMapper *importUIDMapper,
	memoIDsByUID map[string]int32,
	result *importExportResult,
) error {
	inputs := make([]importAttachmentInput, 0, len(records))
	for _, record := range records {
		if err := validateImportAttachmentContentPath(record.ContentPath); err != nil {
			result.SkippedAttachments++
			addImportExportWarning(&result.Warnings, fmt.Sprintf("%s: %v", record.UID, err))
			continue
		}
		zipEntry := zipEntries[record.ContentPath]
		if zipEntry == nil {
			result.SkippedAttachments++
			addImportExportWarning(&result.Warnings, fmt.Sprintf("%s: attachment content missing", record.UID))
			continue
		}
		blob, err := readZipEntry(zipEntry)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "failed to read attachment content").Wrap(err)
		}
		inputs = append(inputs, importAttachmentInput{
			Record: record,
			Blob:   blob,
		})
	}
	return s.importAttachmentsFromRecords(ctx, inputs, userIDs, scope, uidMapper, memoIDsByUID, result)
}

type importAttachmentInput struct {
	Record importExportAttachmentRecord
	Blob   []byte
}

func (s *APIV1Service) importAttachmentsFromRecords(
	ctx context.Context,
	inputs []importAttachmentInput,
	userIDs map[string]int32,
	scope importExportScope,
	uidMapper *importUIDMapper,
	memoIDsByUID map[string]int32,
	result *importExportResult,
) error {
	for _, input := range inputs {
		record := input.Record
		creatorID, ok := importCreatorID(userIDs, record.CreatorUsername, scope)
		if !ok {
			result.SkippedAttachments++
			addImportExportWarning(&result.Warnings, fmt.Sprintf("%s: attachment creator %q not found", record.UID, record.CreatorUsername))
			continue
		}
		targetUID, existing, err := s.resolveImportAttachmentUID(ctx, record.UID, creatorID, scope, uidMapper)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to get attachment").Wrap(err)
		}
		if existing != nil {
			if scope == importExportScopeMine && existing.CreatorID != creatorID {
				result.SkippedAttachments++
				addImportExportWarning(&result.Warnings, fmt.Sprintf("%s: attachment UID already belongs to another user", targetUID))
				continue
			}
			result.SkippedAttachments++
			continue
		}
		if !validateFilename(record.Filename) {
			result.SkippedAttachments++
			addImportExportWarning(&result.Warnings, fmt.Sprintf("%s: invalid filename", record.UID))
			continue
		}
		blob := input.Blob
		if record.Sha256 != "" {
			sum := sha256.Sum256(blob)
			if !strings.EqualFold(record.Sha256, hex.EncodeToString(sum[:])) {
				result.SkippedAttachments++
				addImportExportWarning(&result.Warnings, fmt.Sprintf("%s: attachment checksum mismatch", record.UID))
				continue
			}
		}
		attachmentType, ok := importAttachmentType(record.Type, blob)
		if !ok {
			result.SkippedAttachments++
			addImportExportWarning(&result.Warnings, fmt.Sprintf("%s: invalid attachment type", record.UID))
			continue
		}
		payload, err := unmarshalAttachmentPayload(record.Payload)
		if err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid attachment payload").Wrap(err)
		}
		create := &store.Attachment{
			UID:       targetUID,
			CreatorID: creatorID,
			Filename:  record.Filename,
			Type:      attachmentType,
			Size:      int64(len(blob)),
			Blob:      blob,
			Payload:   payload,
		}
		if record.MemoUID != "" {
			memoID, ok := memoIDsByUID[record.MemoUID]
			if !ok {
				result.SkippedAttachments++
				addImportExportWarning(&result.Warnings, fmt.Sprintf("%s: target memo %q not found", record.UID, record.MemoUID))
				continue
			}
			create.MemoID = &memoID
		}
		if err := SaveAttachmentBlob(ctx, s.Profile, s.Store, create); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to save attachment content").Wrap(err)
		}
		if _, err := s.Store.CreateAttachment(ctx, create); err != nil {
			if isUniqueConstraintError(err) {
				result.SkippedAttachments++
				continue
			}
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to create attachment").Wrap(err)
		}
		result.CreatedAttachments++
	}
	return nil
}

func (s *APIV1Service) importRelationsFromZip(ctx context.Context, zipReader *zip.Reader, memoIDsByUID map[string]int32, result *importExportResult) error {
	records, err := readJSONLFromZip[importExportRelationRecord](zipReader, "memo_relations.jsonl")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid memo_relations.jsonl").Wrap(err)
	}
	for _, record := range records {
		memoID, memoOK := memoIDsByUID[record.MemoUID]
		relatedMemoID, relatedOK := memoIDsByUID[record.RelatedMemoUID]
		if !memoOK || !relatedOK {
			result.SkippedRelations++
			continue
		}
		if memoID == relatedMemoID {
			result.SkippedRelations++
			continue
		}
		relationType := importRelationType(record.Type)
		existing, err := s.Store.ListMemoRelations(ctx, &store.FindMemoRelation{
			MemoID:        &memoID,
			RelatedMemoID: &relatedMemoID,
			Type:          &relationType,
		})
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to check memo relation").Wrap(err)
		}
		if len(existing) > 0 {
			result.SkippedRelations++
			continue
		}
		if _, err := s.Store.UpsertMemoRelation(ctx, &store.MemoRelation{
			MemoID:        memoID,
			RelatedMemoID: relatedMemoID,
			Type:          relationType,
		}); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to import memo relation").Wrap(err)
		}
		result.CreatedRelations++
	}
	return nil
}

func (s *APIV1Service) importReactionsFromZip(
	ctx context.Context,
	zipReader *zip.Reader,
	userIDs map[string]int32,
	scope importExportScope,
	memoIDsByUID map[string]int32,
	result *importExportResult,
) error {
	records, err := readJSONLFromZip[importExportReactionRecord](zipReader, "reactions.jsonl")
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid reactions.jsonl").Wrap(err)
	}
	for _, record := range records {
		creatorID, ok := importCreatorID(userIDs, record.CreatorUsername, scope)
		if !ok {
			result.SkippedReactions++
			continue
		}
		memoID, ok := memoIDsByUID[record.MemoUID]
		if !ok {
			result.SkippedReactions++
			continue
		}
		existing, err := s.Store.GetReaction(ctx, &store.FindReaction{
			CreatorID: &creatorID,
			MemoID:    &memoID,
		})
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to check reaction").Wrap(err)
		}
		if existing != nil && existing.ReactionType == record.ReactionType {
			result.SkippedReactions++
			continue
		}
		if _, err := s.Store.UpsertReaction(ctx, &store.Reaction{
			CreatorID:    creatorID,
			MemoID:       memoID,
			ReactionType: record.ReactionType,
		}); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to import reaction").Wrap(err)
		}
		result.CreatedReactions++
	}
	return nil
}

func importCreatorID(userIDs map[string]int32, username string, scope importExportScope) (int32, bool) {
	if scope == importExportScopeMine {
		id, ok := userIDs[""]
		return id, ok
	}
	id, ok := userIDs[username]
	return id, ok
}

func importVisibility(raw string) store.Visibility {
	switch store.Visibility(strings.ToUpper(strings.TrimSpace(raw))) {
	case store.Public:
		return store.Public
	case store.Protected:
		return store.Protected
	default:
		return store.Private
	}
}

func importRowStatus(raw string) store.RowStatus {
	switch store.RowStatus(strings.ToUpper(strings.TrimSpace(raw))) {
	case store.Archived:
		return store.Archived
	default:
		return store.Normal
	}
}

func importRelationType(raw string) store.MemoRelationType {
	switch store.MemoRelationType(strings.ToUpper(strings.TrimSpace(raw))) {
	case store.MemoRelationComment:
		return store.MemoRelationComment
	default:
		return store.MemoRelationReference
	}
}

func importAttachmentType(raw string, blob []byte) (string, bool) {
	mimeType := strings.TrimSpace(raw)
	if mimeType == "" {
		mimeType = http.DetectContentType(blob)
	}
	return normalizeMimeType(mimeType)
}

func marshalProtoJSON(message proto.Message) (json.RawMessage, error) {
	if message == nil {
		return nil, nil
	}
	b, err := protojson.Marshal(message)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(b), nil
}

func unmarshalMemoPayload(raw json.RawMessage) (*storepb.MemoPayload, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	payload := &storepb.MemoPayload{}
	if err := (protojson.UnmarshalOptions{AllowPartial: true, DiscardUnknown: true}).Unmarshal(raw, payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func unmarshalAttachmentPayload(raw json.RawMessage) (*storepb.AttachmentPayload, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return &storepb.AttachmentPayload{}, nil
	}
	payload := &storepb.AttachmentPayload{}
	if err := (protojson.UnmarshalOptions{AllowPartial: true, DiscardUnknown: true}).Unmarshal(raw, payload); err != nil {
		return nil, err
	}
	return sanitizeAttachmentPayload(payload), nil
}

func sanitizeAttachmentPayload(payload *storepb.AttachmentPayload) *storepb.AttachmentPayload {
	if payload == nil {
		return &storepb.AttachmentPayload{}
	}
	sanitized := &storepb.AttachmentPayload{}
	if motionMedia := payload.GetMotionMedia(); motionMedia != nil {
		sanitized.MotionMedia = proto.Clone(motionMedia).(*storepb.MotionMedia)
	}
	if mediaMetadata := payload.GetMediaMetadata(); mediaMetadata != nil {
		sanitized.MediaMetadata = proto.Clone(mediaMetadata).(*storepb.MediaMetadata)
	}
	return sanitized
}

func writeJSONToZip(zipWriter *zip.Writer, entryName string, value any) error {
	entry, err := zipWriter.Create(entryName)
	if err != nil {
		return errors.Wrapf(err, "failed to create zip entry %s", entryName)
	}
	encoder := json.NewEncoder(entry)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		return errors.Wrapf(err, "failed to write zip entry %s", entryName)
	}
	return nil
}

func writeJSONLToZip[T any](zipWriter *zip.Writer, entryName string, records []T) error {
	entry, err := zipWriter.Create(entryName)
	if err != nil {
		return errors.Wrapf(err, "failed to create zip entry %s", entryName)
	}
	encoder := json.NewEncoder(entry)
	for _, record := range records {
		if err := encoder.Encode(record); err != nil {
			return errors.Wrapf(err, "failed to write zip entry %s", entryName)
		}
	}
	return nil
}

func readJSONFromZip[T any](zipReader *zip.Reader, entryName string) (*T, error) {
	zipEntry := findZipEntry(zipReader, entryName)
	if zipEntry == nil {
		return nil, errors.Errorf("zip entry %s not found", entryName)
	}
	reader, err := zipEntry.Open()
	if err != nil {
		return nil, errors.Wrapf(err, "failed to open zip entry %s", entryName)
	}
	defer reader.Close()
	var value T
	if err := json.NewDecoder(reader).Decode(&value); err != nil {
		return nil, errors.Wrapf(err, "failed to decode zip entry %s", entryName)
	}
	return &value, nil
}

func readJSONLFromZip[T any](zipReader *zip.Reader, entryName string) ([]T, error) {
	zipEntry := findZipEntry(zipReader, entryName)
	if zipEntry == nil {
		return []T{}, nil
	}
	reader, err := zipEntry.Open()
	if err != nil {
		return nil, errors.Wrapf(err, "failed to open zip entry %s", entryName)
	}
	defer reader.Close()
	decoder := json.NewDecoder(reader)
	records := []T{}
	for {
		var record T
		if err := decoder.Decode(&record); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			return nil, errors.Wrapf(err, "failed to decode zip entry %s", entryName)
		}
		records = append(records, record)
	}
	return records, nil
}

func zipEntriesByName(zipReader *zip.Reader) map[string]*zip.File {
	entries := make(map[string]*zip.File, len(zipReader.File))
	for _, file := range zipReader.File {
		entries[file.Name] = file
	}
	return entries
}

func findZipEntry(zipReader *zip.Reader, entryName string) *zip.File {
	for _, file := range zipReader.File {
		if file.Name == entryName {
			return file
		}
	}
	return nil
}

func readZipEntry(zipEntry *zip.File) ([]byte, error) {
	reader, err := zipEntry.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return io.ReadAll(reader)
}

func validateImportAttachmentContentPath(contentPath string) error {
	if contentPath == "" {
		return errors.New("attachment content path is empty")
	}
	if strings.Contains(contentPath, "\\") {
		return errors.New("attachment content path contains backslash")
	}
	cleaned := path.Clean(contentPath)
	if cleaned != contentPath || strings.HasPrefix(cleaned, "../") || cleaned == ".." || !strings.HasPrefix(cleaned, "attachments/") {
		return errors.New("attachment content path is unsafe")
	}
	return nil
}

func addImportExportWarning(warnings *[]string, warning string) {
	if len(*warnings) >= maxImportExportWarnings {
		return
	}
	*warnings = append(*warnings, warning)
}

func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	errMsg := err.Error()
	return strings.Contains(errMsg, "UNIQUE constraint failed") ||
		strings.Contains(errMsg, "duplicate key") ||
		strings.Contains(errMsg, "Duplicate entry")
}
