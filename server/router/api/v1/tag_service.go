package v1

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/labstack/echo/v5"
	"github.com/pkg/errors"
	"google.golang.org/protobuf/proto"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/server/runner/memopayload"
	"github.com/usememos/memos/store"
)

const tagRenamePageSize = 500

type renameTagRequest struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type renameTagResponse struct {
	From             string `json:"from"`
	To               string `json:"to"`
	ScannedMemos     int    `json:"scannedMemos"`
	UpdatedMemos     int    `json:"updatedMemos"`
	MigratedMetadata bool   `json:"migratedMetadata"`
}

// RegisterTagRoutes registers tag maintenance routes that are intentionally kept
// outside proto until the surface settles.
func (s *APIV1Service) RegisterTagRoutes(echoServer *echo.Echo) {
	authenticator := auth.NewAuthenticator(s.Store, s.Secret)
	apiGroup := echoServer.Group("/api/v1")
	apiGroup.POST("/tags:rename", func(c *echo.Context) error {
		return s.renameTag(c, authenticator)
	})
}

func (s *APIV1Service) renameTag(c *echo.Context, authenticator *auth.Authenticator) error {
	ctx := c.Request().Context()
	user, err := authenticator.AuthenticateToUser(ctx, c.Request().Header.Get(echo.HeaderAuthorization), c.Request().Header.Get("Cookie"))
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "failed authentication").Wrap(err)
	}
	if user == nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "authentication required")
	}

	c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, 1<<20)
	var request renameTagRequest
	if err := json.NewDecoder(c.Request().Body).Decode(&request); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body").Wrap(err)
	}

	from, err := s.normalizeTagForRename(request.From)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid source tag").Wrap(err)
	}
	to, err := s.normalizeTagForRename(request.To)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid target tag").Wrap(err)
	}
	if from == to {
		return echo.NewHTTPError(http.StatusBadRequest, "target tag must be different")
	}

	result, err := s.renameUserTag(ctx, user, from, to)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, result)
}

func (s *APIV1Service) normalizeTagForRename(tag string) (string, error) {
	tag = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(tag), "#"))
	if tag == "" {
		return "", errors.New("tag cannot be empty")
	}
	if strings.Contains(tag, "#") || strings.ContainsFunc(tag, unicode.IsSpace) {
		return "", errors.New("tag cannot contain spaces or #")
	}

	extracted, err := s.MarkdownService.ExtractTags([]byte("#" + tag))
	if err != nil {
		return "", err
	}
	for _, item := range extracted {
		if item == tag {
			return tag, nil
		}
	}
	return "", errors.Errorf("tag %q is not recognized", tag)
}

func (s *APIV1Service) renameUserTag(ctx context.Context, user *store.User, from, to string) (*renameTagResponse, error) {
	result := &renameTagResponse{From: from, To: to}
	normal := store.Normal
	limit := tagRenamePageSize
	offset := 0
	contentLengthLimit, err := s.getContentLengthLimit(ctx)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to get content length limit").Wrap(err)
	}

	for {
		memos, err := s.Store.ListMemos(ctx, &store.FindMemo{
			CreatorID:       &user.ID,
			RowStatus:       &normal,
			ExcludeComments: true,
			Limit:           &limit,
			Offset:          &offset,
			OrderByTimeAsc:  true,
		})
		if err != nil {
			return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to list memos").Wrap(err)
		}
		if len(memos) == 0 {
			break
		}

		for _, memo := range memos {
			result.ScannedMemos++
			nextContent, err := s.MarkdownService.RenameTag([]byte(memo.Content), from, to)
			if err != nil {
				return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to rename memo tag").Wrap(err)
			}
			if nextContent == memo.Content {
				continue
			}
			if len(nextContent) > contentLengthLimit {
				return nil, echo.NewHTTPError(http.StatusBadRequest, "renamed memo content exceeds length limit")
			}

			nextMemo := *memo
			nextMemo.Content = nextContent
			if err := memopayload.RebuildMemoPayload(ctx, &nextMemo, s.MarkdownService); err != nil {
				return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to rebuild memo payload").Wrap(err)
			}
			updatedTs := time.Now().Unix()
			if err := s.Store.UpdateMemo(ctx, &store.UpdateMemo{
				ID:        memo.ID,
				Content:   &nextMemo.Content,
				Payload:   nextMemo.Payload,
				UpdatedTs: &updatedTs,
			}); err != nil {
				return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to update memo").Wrap(err)
			}

			updatedMemo, parentMemo, memoMessage, err := s.buildUpdatedMemoState(ctx, memo.ID)
			if err != nil {
				return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to build updated memo state").Wrap(err)
			}
			s.dispatchMemoUpdatedSideEffects(ctx, updatedMemo, parentMemo, memoMessage)
			result.UpdatedMemos++
		}

		if len(memos) < limit {
			break
		}
		offset += len(memos)
	}

	migrated, err := s.migrateUserTagMetadata(ctx, user.ID, from, to)
	if err != nil {
		return nil, echo.NewHTTPError(http.StatusInternalServerError, "failed to migrate tag metadata").Wrap(err)
	}
	result.MigratedMetadata = migrated
	return result, nil
}

func (s *APIV1Service) migrateUserTagMetadata(ctx context.Context, userID int32, from, to string) (bool, error) {
	setting, err := s.Store.GetUserSetting(ctx, &store.FindUserSetting{
		UserID: &userID,
		Key:    storepb.UserSetting_TAGS,
	})
	if err != nil {
		return false, err
	}
	if setting == nil || setting.GetTags() == nil || len(setting.GetTags().Tags) == 0 {
		return false, nil
	}

	current := setting.GetTags().Tags
	next := make(map[string]*storepb.UserTagMetadata, len(current))
	migrated := false
	for tag, metadata := range current {
		nextTag := renamedTagPath(tag, from, to)
		if nextTag != tag {
			migrated = true
		}
		next[nextTag] = mergeUserTagMetadata(next[nextTag], metadata)
	}
	if !migrated {
		return false, nil
	}

	_, err = s.Store.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: userID,
		Key:    storepb.UserSetting_TAGS,
		Value: &storepb.UserSetting_Tags{
			Tags: &storepb.TagsUserSetting{Tags: next},
		},
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

func renamedTagPath(tag, from, to string) string {
	if tag == from {
		return to
	}
	if strings.HasPrefix(tag, from+"/") {
		return to + strings.TrimPrefix(tag, from)
	}
	return tag
}

func mergeUserTagMetadata(left, right *storepb.UserTagMetadata) *storepb.UserTagMetadata {
	if left == nil {
		if right == nil {
			return &storepb.UserTagMetadata{}
		}
		return proto.Clone(right).(*storepb.UserTagMetadata)
	}
	merged := proto.Clone(left).(*storepb.UserTagMetadata)
	if right == nil {
		return merged
	}
	if merged.BackgroundColor == nil && right.BackgroundColor != nil {
		merged.BackgroundColor = right.BackgroundColor
	}
	merged.BlurContent = merged.BlurContent || right.BlurContent
	merged.Pinned = merged.Pinned || right.Pinned
	return merged
}
