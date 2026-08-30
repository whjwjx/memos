package v1

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMergeImportUploadChunks(t *testing.T) {
	t.Parallel()

	content := []byte("hello chunks")
	dir := t.TempDir()
	chunksDir := filepath.Join(dir, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(chunksDir, importUploadChunkName(0)), content[:5], 0644))
	require.NoError(t, os.WriteFile(filepath.Join(chunksDir, importUploadChunkName(1)), content[5:10], 0644))
	require.NoError(t, os.WriteFile(filepath.Join(chunksDir, importUploadChunkName(2)), content[10:], 0644))

	outputPath := filepath.Join(dir, "complete.zip")
	err := mergeImportUploadChunks(dir, outputPath, &importUploadMetadata{
		Size:       int64(len(content)),
		Sha256:     hexSha256(content),
		ChunkSize:  5,
		ChunkCount: 3,
	})
	require.NoError(t, err)

	got, err := os.ReadFile(outputPath)
	require.NoError(t, err)
	require.Equal(t, content, got)
}

func TestMergeImportUploadChunksMissingChunk(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "chunks"), 0755))

	err := mergeImportUploadChunks(dir, filepath.Join(dir, "complete.zip"), &importUploadMetadata{
		Size:       5,
		ChunkSize:  5,
		ChunkCount: 1,
	})
	require.Error(t, err)
}
