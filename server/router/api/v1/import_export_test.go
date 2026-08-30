package v1

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func TestParseImportExportScope(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		raw     string
		want    importExportScope
		wantErr bool
	}{
		{
			name: "defaults to mine",
			want: importExportScopeMine,
		},
		{
			name: "mine",
			raw:  "mine",
			want: importExportScopeMine,
		},
		{
			name: "all",
			raw:  "all",
			want: importExportScopeAll,
		},
		{
			name:    "invalid",
			raw:     "team",
			wantErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseImportExportScope(test.raw)
			if test.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, test.want, got)
		})
	}
}

func TestParseImportSource(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		raw     string
		want    importSource
		wantErr bool
	}{
		{
			name: "defaults to auto",
			want: importSourceAuto,
		},
		{
			name: "memos",
			raw:  "memos",
			want: importSourceMemos,
		},
		{
			name: "flomo",
			raw:  "flomo",
			want: importSourceFlomo,
		},
		{
			name: "trim and lowercase",
			raw:  " Flomo ",
			want: importSourceFlomo,
		},
		{
			name:    "invalid",
			raw:     "notion",
			wantErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseImportSource(test.raw)
			if test.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, test.want, got)
		})
	}
}

func TestValidateImportAttachmentContentPath(t *testing.T) {
	t.Parallel()

	require.NoError(t, validateImportAttachmentContentPath("attachments/abc/file.png"))
	require.Error(t, validateImportAttachmentContentPath(""))
	require.Error(t, validateImportAttachmentContentPath("../attachments/abc/file.png"))
	require.Error(t, validateImportAttachmentContentPath("attachments/../file.png"))
	require.Error(t, validateImportAttachmentContentPath("assets/abc/file.png"))
	require.Error(t, validateImportAttachmentContentPath("attachments\\abc\\file.png"))
}

func TestImportAttachmentType(t *testing.T) {
	t.Parallel()

	mimeType, ok := importAttachmentType("image/png; charset=binary", []byte("ignored"))
	require.True(t, ok)
	require.Equal(t, "image/png", mimeType)

	mimeType, ok = importAttachmentType("", []byte("hello"))
	require.True(t, ok)
	require.Equal(t, "text/plain", mimeType)

	_, ok = importAttachmentType("not a mime type", []byte("hello"))
	require.False(t, ok)
}

func TestSanitizeAttachmentPayloadDropsS3Object(t *testing.T) {
	t.Parallel()

	payload := &storepb.AttachmentPayload{
		Payload: &storepb.AttachmentPayload_S3Object_{
			S3Object: &storepb.AttachmentPayload_S3Object{
				Key:       "source/key.png",
				StorageId: "source-storage",
				S3Config: &storepb.StorageS3Config{
					Bucket:          "bucket",
					AccessKeySecret: "secret",
				},
			},
		},
		MotionMedia: &storepb.MotionMedia{
			GroupId: "motion-group",
		},
		MediaMetadata: &storepb.MediaMetadata{
			Width:  int32Ptr(100),
			Height: int32Ptr(200),
		},
	}

	sanitized := sanitizeAttachmentPayload(payload)

	require.Nil(t, sanitized.GetS3Object())
	require.Equal(t, "motion-group", sanitized.GetMotionMedia().GetGroupId())
	require.Equal(t, int32(100), sanitized.GetMediaMetadata().GetWidth())
	require.Equal(t, int32(200), sanitized.GetMediaMetadata().GetHeight())
}

func TestImportUIDMapperScopesMineByUser(t *testing.T) {
	t.Parallel()

	alice := &store.User{ID: 1}
	bob := &store.User{ID: 2}

	aliceMapper := newImportUIDMapper(alice, importExportScopeMine)
	bobMapper := newImportUIDMapper(bob, importExportScopeMine)
	allMapper := newImportUIDMapper(alice, importExportScopeAll)

	require.Equal(t, aliceMapper.memoUID("memo-source"), aliceMapper.memoUID("memo-source"))
	require.Equal(t, aliceMapper.attachmentUID("att-source"), aliceMapper.attachmentUID("att-source"))
	require.NotEqual(t, aliceMapper.memoUID("memo-source"), bobMapper.memoUID("memo-source"))
	require.NotEqual(t, aliceMapper.attachmentUID("att-source"), bobMapper.attachmentUID("att-source"))
	require.Equal(t, "memo-source", allMapper.memoUID("memo-source"))
	require.Equal(t, "att-source", allMapper.attachmentUID("att-source"))
}

func TestRewriteImportedAttachmentLinks(t *testing.T) {
	t.Parallel()

	content := `![image](/file/attachments/old-att/image.png)
<img src="/file/attachments/second-att">
/file/attachments/missing-att
https://example.com/file/attachments/old-att`

	got := rewriteImportedAttachmentLinks(content, map[string]string{
		"old-att":    "att-new",
		"second-att": "att-second-new",
	})

	require.Contains(t, got, "![image](/file/attachments/att-new/image.png)")
	require.Contains(t, got, `<img src="/file/attachments/att-second-new">`)
	require.Contains(t, got, "/file/attachments/missing-att")
	require.Contains(t, got, "https://example.com/file/attachments/old-att")
}

func TestImportExportManifestJSON(t *testing.T) {
	t.Parallel()

	manifest := &importExportManifest{
		Format:     importExportFormat,
		Version:    importExportVersion,
		Scope:      string(importExportScopeMine),
		ExportedAt: "2026-08-29T00:00:00+08:00",
		ExportedBy: "alice",
		Counts: importExportCounts{
			Memos:       1,
			Attachments: 2,
		},
	}

	raw, err := json.Marshal(manifest)
	require.NoError(t, err)

	var decoded importExportManifest
	require.NoError(t, json.Unmarshal(raw, &decoded))
	require.Equal(t, importExportFormat, decoded.Format)
	require.Equal(t, importExportVersion, decoded.Version)
	require.Equal(t, string(importExportScopeMine), decoded.Scope)
	require.Equal(t, 1, decoded.Counts.Memos)
	require.Equal(t, 2, decoded.Counts.Attachments)
}

func int32Ptr(v int32) *int32 {
	return &v
}
