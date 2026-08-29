package v1

import (
	"path"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResolveLocalAttachmentBackupPath(t *testing.T) {
	t.Parallel()

	dataDir := t.TempDir()

	t.Run("relative reference", func(t *testing.T) {
		localPath, zipEntry, err := resolveLocalAttachmentBackupPath(dataDir, "assets/image.png")
		require.NoError(t, err)
		require.Equal(t, filepath.Join(dataDir, "assets", "image.png"), localPath)
		require.Equal(t, path.Join("attachments", "assets/image.png"), zipEntry)
	})

	t.Run("absolute reference inside data directory", func(t *testing.T) {
		reference := filepath.Join(dataDir, "assets", "audio.mp3")

		localPath, zipEntry, err := resolveLocalAttachmentBackupPath(dataDir, reference)

		require.NoError(t, err)
		require.Equal(t, reference, localPath)
		require.Equal(t, path.Join("attachments", "assets/audio.mp3"), zipEntry)
	})

	t.Run("relative reference outside data directory", func(t *testing.T) {
		_, _, err := resolveLocalAttachmentBackupPath(dataDir, "../secret.txt")
		require.ErrorContains(t, err, "outside data directory")
	})

	t.Run("absolute reference outside data directory", func(t *testing.T) {
		reference := filepath.Join(t.TempDir(), "outside.png")

		_, _, err := resolveLocalAttachmentBackupPath(dataDir, reference)

		require.ErrorContains(t, err, "outside data directory")
	})
}
