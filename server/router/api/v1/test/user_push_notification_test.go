package test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	apiv1 "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/notification"
	"github.com/usememos/memos/store"
)

type recordingWebPushSender struct {
	subscriptions []*store.UserPushSubscription
	payloads      []*notification.WebPushPayload
	settings      []*storepb.InstanceNotificationSetting_WebPushSetting
}

func (s *recordingWebPushSender) Send(_ context.Context, subscription *store.UserPushSubscription, payload *notification.WebPushPayload, setting *storepb.InstanceNotificationSetting_WebPushSetting) error {
	s.subscriptions = append(s.subscriptions, subscription)
	s.payloads = append(s.payloads, payload)
	s.settings = append(s.settings, setting)
	return nil
}

func TestGetUserPushNotificationConfigCreatesVAPIDKeys(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "push-config-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	config, err := ts.Service.GetUserPushNotificationConfig(userCtx, &apiv1.GetUserPushNotificationConfigRequest{
		Parent: fmt.Sprintf("users/%s", user.Username),
	})
	require.NoError(t, err)
	require.True(t, config.Enabled)
	require.NotEmpty(t, config.VapidPublicKey)

	stored, err := ts.Store.GetInstanceNotificationSetting(ctx)
	require.NoError(t, err)
	require.NotNil(t, stored.GetWebPush())
	require.Equal(t, config.VapidPublicKey, stored.GetWebPush().GetVapidPublicKey())
	require.NotEmpty(t, stored.GetWebPush().GetVapidPrivateKey())
}

func TestGetUserPushNotificationConfigPreservesDisabledSetting(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "push-disabled-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_NOTIFICATION,
		Value: &storepb.InstanceSetting_NotificationSetting{NotificationSetting: &storepb.InstanceNotificationSetting{
			WebPush: &storepb.InstanceNotificationSetting_WebPushSetting{Enabled: false},
		}},
	})
	require.NoError(t, err)

	config, err := ts.Service.GetUserPushNotificationConfig(userCtx, &apiv1.GetUserPushNotificationConfigRequest{
		Parent: fmt.Sprintf("users/%s", user.Username),
	})
	require.NoError(t, err)
	require.False(t, config.Enabled)
	require.NotEmpty(t, config.VapidPublicKey)

	stored, err := ts.Store.GetInstanceNotificationSetting(ctx)
	require.NoError(t, err)
	require.False(t, stored.GetWebPush().GetEnabled())
	require.NotEmpty(t, stored.GetWebPush().GetVapidPrivateKey())
}

func TestUserPushSubscriptionLifecycleAndTestNotification(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	sender := &recordingWebPushSender{}
	ts.Service.NotificationWebPushSender = sender

	user, err := ts.CreateRegularUser(ctx, "push-subscription-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	parent := fmt.Sprintf("users/%s", user.Username)

	created, err := ts.Service.CreateUserPushSubscription(userCtx, &apiv1.CreateUserPushSubscriptionRequest{
		Parent: parent,
		Subscription: &apiv1.UserPushSubscription{
			Endpoint:  "https://push.example.test/api-subscription",
			P256Dh:    "p256dh-key",
			Auth:      "auth-secret",
			UserAgent: "api-test",
		},
	})
	require.NoError(t, err)
	require.NotEmpty(t, created.Name)
	require.Equal(t, "https://push.example.test/api-subscription", created.Endpoint)

	list, err := ts.Service.ListUserPushSubscriptions(userCtx, &apiv1.ListUserPushSubscriptionsRequest{Parent: parent})
	require.NoError(t, err)
	require.Len(t, list.Subscriptions, 1)
	require.Equal(t, created.Name, list.Subscriptions[0].Name)

	_, err = ts.Service.TestUserPushNotification(userCtx, &apiv1.TestUserPushNotificationRequest{Parent: parent})
	require.NoError(t, err)
	require.Len(t, sender.subscriptions, 1)
	require.Len(t, sender.payloads, 1)
	require.Equal(t, "Memos notification test", sender.payloads[0].Title)
	require.Equal(t, "/calendar", sender.payloads[0].URL)
	require.NotEmpty(t, sender.settings[0].GetVapidPublicKey())

	_, err = ts.Service.DeleteUserPushSubscription(userCtx, &apiv1.DeleteUserPushSubscriptionRequest{Name: created.Name})
	require.NoError(t, err)
	list, err = ts.Service.ListUserPushSubscriptions(userCtx, &apiv1.ListUserPushSubscriptionsRequest{Parent: parent})
	require.NoError(t, err)
	require.Empty(t, list.Subscriptions)
}

func TestCreateUserPushSubscriptionRejectsOversizedEndpoint(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "push-oversized-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	_, err = ts.Service.CreateUserPushSubscription(userCtx, &apiv1.CreateUserPushSubscriptionRequest{
		Parent: fmt.Sprintf("users/%s", user.Username),
		Subscription: &apiv1.UserPushSubscription{
			Endpoint: strings.Repeat("x", 769),
			P256Dh:   "p256dh-key",
			Auth:     "auth-secret",
		},
	})
	require.Error(t, err)
	require.Contains(t, err.Error(), "exceed the supported length")
}
