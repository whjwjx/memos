package v1

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/pkg/errors"

	"github.com/usememos/memos/store"
)

const (
	attachmentThumbnailCacheFolder = ".thumbnail_cache"
	attachmentThumbnailMaxSize     = 600
	attachmentThumbnailJPEGQuality = 90
)

var attachmentThumbnailSupportedTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
	"image/jpg":  true,
	"image/webp": true,
}

func isThumbnailPrewarmSupported(mimeType string) bool {
	return attachmentThumbnailSupportedTypes[mimeType]
}

func (s *APIV1Service) prewarmAttachmentThumbnail(ctx context.Context, attachment *store.Attachment, source []byte) error {
	thumbnailPath, err := s.attachmentThumbnailPath(attachment)
	if err != nil {
		return err
	}
	if _, err := os.Stat(thumbnailPath); err == nil {
		return nil
	}
	if len(source) == 0 {
		return nil
	}
	if hasAttachmentThumbnailSensitiveMetadata(source) {
		return nil
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	img, err := imaging.Decode(bytes.NewReader(source), imaging.AutoOrientation(true))
	if err != nil {
		return errors.Wrap(err, "failed to decode image")
	}

	width, height := img.Bounds().Dx(), img.Bounds().Dy()
	thumbnailWidth, thumbnailHeight := calculateAttachmentThumbnailDimensions(width, height)
	thumbnailImage := imaging.Resize(img, thumbnailWidth, thumbnailHeight, imaging.Lanczos)

	var buf bytes.Buffer
	if err := imaging.Encode(&buf, thumbnailImage, imaging.JPEG, imaging.JPEGQuality(attachmentThumbnailJPEGQuality)); err != nil {
		return errors.Wrap(err, "failed to encode thumbnail")
	}
	if err := os.WriteFile(thumbnailPath, buf.Bytes(), 0o644); err != nil {
		return errors.Wrap(err, "failed to save thumbnail")
	}
	return nil
}

func (s *APIV1Service) attachmentThumbnailPath(attachment *store.Attachment) (string, error) {
	cacheFolder := filepath.Join(s.Profile.Data, attachmentThumbnailCacheFolder)
	if err := os.MkdirAll(cacheFolder, os.ModePerm); err != nil {
		return "", errors.Wrap(err, "failed to create thumbnail cache folder")
	}
	return filepath.Join(cacheFolder, attachment.UID+".v2.jpeg"), nil
}

func calculateAttachmentThumbnailDimensions(width, height int) (int, int) {
	if max(width, height) <= attachmentThumbnailMaxSize {
		return width, height
	}
	if width >= height {
		return attachmentThumbnailMaxSize, 0
	}
	return 0, attachmentThumbnailMaxSize
}

func hasAttachmentThumbnailSensitiveMetadata(data []byte) bool {
	for _, marker := range [][]byte{
		[]byte("ICC_PROFILE"),
		[]byte("iCCP"),
		[]byte("ICCP"),
		[]byte("cICP"),
		[]byte("mDCv"),
		[]byte("cLLi"),
	} {
		if bytes.Contains(data, marker) {
			return true
		}
	}

	lowerData := strings.ToLower(string(data))
	for _, marker := range []string{
		"hdrgm:",
		"hdr gain map",
		"hdrgainmap",
		"gainmap",
		"ultrahdr",
		"adobe:hdrgainmap",
		"aux:hdr",
		"auxiliaryimagetype",
		"display p3",
		"display-p3",
		"rec.2020",
		"bt.2020",
		"arib-std-b67",
		"smpte st 2084",
	} {
		if strings.Contains(lowerData, marker) {
			return true
		}
	}

	return false
}
