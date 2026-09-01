package notification

import (
	"context"
	"encoding/json"
	stderrors "errors"
	"net/http"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/pkg/errors"

	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

const (
	defaultWebPushSubject        = "mailto:notifications@usememos.com"
	defaultWebPushRequestTimeout = 10 * time.Second
)

// DefaultWebPushSubject returns the fallback VAPID subject used by this server.
func DefaultWebPushSubject() string {
	return defaultWebPushSubject
}

// WebPushPayload is the JSON payload delivered to the browser service worker.
type WebPushPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url,omitempty"`
	Tag   string `json:"tag,omitempty"`
}

// WebPushDeliveryError records the HTTP status returned by a push service.
type WebPushDeliveryError struct {
	StatusCode int
}

// Error returns a human-readable delivery failure.
func (e *WebPushDeliveryError) Error() string {
	return errors.Errorf("web push endpoint returned status %d", e.StatusCode).Error()
}

// ShouldDisablePushSubscription reports whether a failed delivery means the
// browser subscription is permanently expired and should be disabled.
func ShouldDisablePushSubscription(err error) bool {
	var deliveryErr *WebPushDeliveryError
	if !stderrors.As(err, &deliveryErr) {
		return false
	}
	return deliveryErr.StatusCode == http.StatusGone || deliveryErr.StatusCode == http.StatusNotFound
}

// WebPushSender sends browser push notifications.
type WebPushSender interface {
	Send(ctx context.Context, subscription *store.UserPushSubscription, payload *WebPushPayload, setting *storepb.InstanceNotificationSetting_WebPushSetting) error
}

// WebPushDispatcher delivers notifications through the Web Push protocol.
type WebPushDispatcher struct {
	// HTTPClient overrides the default Web Push HTTP client, mainly for tests.
	HTTPClient webpush.HTTPClient
	// Timeout caps each Web Push delivery request.
	Timeout time.Duration
}

// Send sends one Web Push notification.
func (d *WebPushDispatcher) Send(ctx context.Context, subscription *store.UserPushSubscription, payload *WebPushPayload, setting *storepb.InstanceNotificationSetting_WebPushSetting) error {
	if subscription == nil {
		return errors.New("subscription is required")
	}
	if payload == nil {
		return errors.New("payload is required")
	}
	if setting == nil || !setting.Enabled || setting.VapidPublicKey == "" || setting.VapidPrivateKey == "" {
		return errors.New("web push setting is not configured")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return errors.Wrap(err, "failed to marshal web push payload")
	}

	timeout := d.Timeout
	if timeout == 0 {
		timeout = defaultWebPushRequestTimeout
	}
	sendCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	httpClient := d.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: timeout}
	}

	resp, err := webpush.SendNotificationWithContext(sendCtx, body, &webpush.Subscription{
		Endpoint: subscription.Endpoint,
		Keys: webpush.Keys{
			Auth:   subscription.Auth,
			P256dh: subscription.P256Dh,
		},
	}, &webpush.Options{
		HTTPClient:      httpClient,
		Subscriber:      webPushSubject(setting),
		TTL:             60 * 60,
		Urgency:         webpush.UrgencyHigh,
		VAPIDPublicKey:  setting.VapidPublicKey,
		VAPIDPrivateKey: setting.VapidPrivateKey,
	})
	if err != nil {
		return errors.Wrap(err, "failed to send web push notification")
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return &WebPushDeliveryError{StatusCode: resp.StatusCode}
	}
	return nil
}

// GenerateWebPushVAPIDKeys creates a new VAPID key pair.
func GenerateWebPushVAPIDKeys() (string, string, error) {
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return "", "", err
	}
	return publicKey, privateKey, nil
}

func webPushSubject(setting *storepb.InstanceNotificationSetting_WebPushSetting) string {
	subject := strings.TrimSpace(setting.GetSubject())
	if subject == "" {
		return defaultWebPushSubject
	}
	return subject
}
