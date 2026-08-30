package v1

import (
	"archive/zip"
	"bytes"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseFlomoZip(t *testing.T) {
	t.Parallel()

	const htmlEntryName = "flomo/export.html"
	zipReader := newTestZipReader(t, map[string][]byte{
		htmlEntryName: []byte(`<!doctype html>
<html>
  <body>
    <div class="memo">
      <div class="time">2026-08-19 09:21:13</div>
      <div class="content">
        <p>你好<strong>world</strong><a href="https://example.com/a">link</a></p>
        <ul><li>Item one</li><li>Item two</li></ul>
      </div>
      <div class="assets">
        <img src="file/image.jpg">
        <div>
          <audio src="file/audio.m4a"></audio>
          <div class="audio-player__content">voice transcript</div>
        </div>
      </div>
    </div>
  </body>
</html>`),
		"flomo/file/image.jpg": []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01},
		"flomo/file/audio.m4a": []byte("audio-data"),
	})

	data, err := parseFlomoZip(zipReader, htmlEntryName, "alice")
	require.NoError(t, err)
	require.Len(t, data.Memos, 1)
	require.Len(t, data.Attachments, 2)
	require.Empty(t, data.Warnings)

	memo := data.Memos[0]
	require.Equal(t, "alice", memo.CreatorUsername)
	require.Equal(t, int64(1787102473), memo.CreatedTs)
	require.Contains(t, memo.Content, "**world**")
	require.Contains(t, memo.Content, "[link](https://example.com/a)")
	require.Contains(t, memo.Content, "- Item one")
	require.Contains(t, memo.Content, "![image.jpg](/file/attachments/flomo-att-")
	require.Contains(t, memo.Content, "voice transcript")
	require.Contains(t, memo.Content, "[audio.m4a](/file/attachments/flomo-att-")

	require.Equal(t, memo.UID, data.Attachments[0].Record.MemoUID)
	require.Equal(t, "image.jpg", data.Attachments[0].Record.Filename)
	require.Equal(t, "image/jpeg", data.Attachments[0].Record.Type)
	require.Equal(t, memo.UID, data.Attachments[1].Record.MemoUID)
	require.Equal(t, "audio.m4a", data.Attachments[1].Record.Filename)
	require.Equal(t, "audio/mp4", data.Attachments[1].Record.Type)
}

func TestResolveFlomoZipEntryName(t *testing.T) {
	t.Parallel()

	got, ok := resolveFlomoZipEntryName("flomo", "file/image%201.jpg")
	require.True(t, ok)
	require.Equal(t, "flomo/file/image 1.jpg", got)

	_, ok = resolveFlomoZipEntryName("flomo", "https://example.com/image.jpg")
	require.False(t, ok)

	_, ok = resolveFlomoZipEntryName("flomo", "/file/image.jpg")
	require.False(t, ok)

	_, ok = resolveFlomoZipEntryName("flomo", "file/../../secret.txt")
	require.False(t, ok)
}

func newTestZipReader(t *testing.T, files map[string][]byte) *zip.Reader {
	t.Helper()

	var buffer bytes.Buffer
	zipWriter := zip.NewWriter(&buffer)
	for name, content := range files {
		writer, err := zipWriter.Create(name)
		require.NoError(t, err)
		_, err = writer.Write(content)
		require.NoError(t, err)
	}
	require.NoError(t, zipWriter.Close())

	reader, err := zip.NewReader(bytes.NewReader(buffer.Bytes()), int64(buffer.Len()))
	require.NoError(t, err)
	return reader
}
