package v1

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/profile"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

func TestCreateAttachmentPrewarmsImageThumbnail(t *testing.T) {
	ctx := context.Background()
	stores := teststore.NewTestingStore(ctx, t)
	defer stores.Close()

	testProfile := &profile.Profile{Data: stores.GetDataDir(), InstanceURL: "http://localhost:8080"}
	s := NewAPIV1Service("test-secret", testProfile, stores)
	user, err := stores.CreateUser(ctx, &store.User{
		Username: "thumbnail-prewarm-user",
		Role:     store.RoleUser,
		Email:    "thumbnail-prewarm-user@example.com",
	})
	require.NoError(t, err)
	userCtx := auth.SetUserInContext(ctx, user, "")

	var pngBuffer bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	require.NoError(t, png.Encode(&pngBuffer, img))
	attachment, err := s.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{
		Attachment: &v1pb.Attachment{
			Filename: "prewarm.png",
			Type:     "image/png",
			Content:  pngBuffer.Bytes(),
		},
	})
	require.NoError(t, err)

	attachmentUID := strings.TrimPrefix(attachment.Name, AttachmentNamePrefix)
	thumbnailPath := filepath.Join(testProfile.Data, ".thumbnail_cache", attachmentUID+".v2.jpeg")
	require.Eventually(t, func() bool {
		info, err := os.Stat(thumbnailPath)
		return err == nil && info.Size() > 0
	}, 3*time.Second, 50*time.Millisecond)
}
