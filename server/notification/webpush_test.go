package notification

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

type blockingHTTPClient struct{}

func (*blockingHTTPClient) Do(request *http.Request) (*http.Response, error) {
	<-request.Context().Done()
	return nil, request.Context().Err()
}

func TestWebPushDispatcherSendTimesOut(t *testing.T) {
	publicKey, privateKey, err := GenerateWebPushVAPIDKeys()
	require.NoError(t, err)

	dispatcher := &WebPushDispatcher{
		HTTPClient: &blockingHTTPClient{},
		Timeout:    10 * time.Millisecond,
	}
	started := time.Now()
	err = dispatcher.Send(context.Background(), &store.UserPushSubscription{
		Endpoint: "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA",
		P256Dh:   "BNNL5ZaTfK81qhXOx23-wewhigUeFb632jN6LvRWCFH1ubQr77FE_9qV1FuojuRmHP42zmf34rXgW80OvUVDgTk",
		Auth:     "zqbxT6JKstKSY9JKibZLSQ",
	}, &WebPushPayload{
		Title: "Memos notification test",
		Body:  "Browser notifications are ready on this device.",
	}, &storepb.InstanceNotificationSetting_WebPushSetting{
		Enabled:         true,
		VapidPublicKey:  publicKey,
		VapidPrivateKey: privateKey,
		Subject:         DefaultWebPushSubject(),
	})

	require.Error(t, err)
	require.Less(t, time.Since(started), time.Second)
	require.False(t, ShouldDisablePushSubscription(err))
}

func TestShouldDisablePushSubscription(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		shouldDrop bool
	}{
		{name: "not found", err: &WebPushDeliveryError{StatusCode: http.StatusNotFound}, shouldDrop: true},
		{name: "gone", err: &WebPushDeliveryError{StatusCode: http.StatusGone}, shouldDrop: true},
		{name: "temporary server error", err: &WebPushDeliveryError{StatusCode: http.StatusBadGateway}, shouldDrop: false},
		{name: "network error", err: errors.New("dial timeout"), shouldDrop: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Equal(t, test.shouldDrop, ShouldDisablePushSubscription(test.err))
		})
	}
}
