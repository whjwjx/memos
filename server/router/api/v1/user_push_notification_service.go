package v1

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/notification"
	"github.com/usememos/memos/store"
)

const (
	pushSubscriptionPathSegment = "/pushSubscriptions/"
	testPushNotificationTitle   = "Memos notification test"
	testPushNotificationBody    = "Browser notifications are ready on this device."
	maxPushEndpointLength       = 768
	maxPushKeyLength            = 512
	maxPushUserAgentLength      = 512
)

func (s *APIV1Service) GetUserPushNotificationConfig(ctx context.Context, request *v1pb.GetUserPushNotificationConfigRequest) (*v1pb.UserPushNotificationConfig, error) {
	if _, err := s.requireCurrentUserForParent(ctx, request.Parent); err != nil {
		return nil, err
	}
	setting, err := s.getOrCreateWebPushSetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load web push setting: %v", err)
	}
	return &v1pb.UserPushNotificationConfig{
		Enabled:        setting.GetEnabled(),
		VapidPublicKey: setting.GetVapidPublicKey(),
	}, nil
}

func (s *APIV1Service) ListUserPushSubscriptions(ctx context.Context, request *v1pb.ListUserPushSubscriptionsRequest) (*v1pb.ListUserPushSubscriptionsResponse, error) {
	user, err := s.requireCurrentUserForParent(ctx, request.Parent)
	if err != nil {
		return nil, err
	}
	subscriptions, err := s.Store.ListUserPushSubscriptions(ctx, &store.FindUserPushSubscription{
		UserID:     &user.ID,
		ActiveOnly: true,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list push subscriptions: %v", err)
	}
	response := &v1pb.ListUserPushSubscriptionsResponse{}
	for _, subscription := range subscriptions {
		response.Subscriptions = append(response.Subscriptions, convertUserPushSubscriptionFromStore(user, subscription))
	}
	return response, nil
}

func (s *APIV1Service) CreateUserPushSubscription(ctx context.Context, request *v1pb.CreateUserPushSubscriptionRequest) (*v1pb.UserPushSubscription, error) {
	user, err := s.requireCurrentUserForParent(ctx, request.Parent)
	if err != nil {
		return nil, err
	}
	if request.Subscription == nil {
		return nil, status.Errorf(codes.InvalidArgument, "subscription is required")
	}
	endpoint := strings.TrimSpace(request.Subscription.Endpoint)
	p256dh := strings.TrimSpace(request.Subscription.P256Dh)
	auth := strings.TrimSpace(request.Subscription.Auth)
	if endpoint == "" || p256dh == "" || auth == "" {
		return nil, status.Errorf(codes.InvalidArgument, "subscription endpoint, p256dh, and auth are required")
	}
	if len(endpoint) > maxPushEndpointLength || len(p256dh) > maxPushKeyLength || len(auth) > maxPushKeyLength {
		return nil, status.Errorf(codes.InvalidArgument, "subscription endpoint or keys exceed the supported length")
	}
	userAgent := strings.TrimSpace(request.Subscription.UserAgent)
	if userAgentRunes := []rune(userAgent); len(userAgentRunes) > maxPushUserAgentLength {
		userAgent = string(userAgentRunes[:maxPushUserAgentLength])
	}
	if _, err := s.getOrCreateWebPushSetting(ctx); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load web push setting: %v", err)
	}

	subscription, err := s.Store.UpsertUserPushSubscription(ctx, &store.UserPushSubscription{
		UserID:    user.ID,
		Endpoint:  endpoint,
		P256Dh:    p256dh,
		Auth:      auth,
		UserAgent: userAgent,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to upsert push subscription: %v", err)
	}
	return convertUserPushSubscriptionFromStore(user, subscription), nil
}

func (s *APIV1Service) DeleteUserPushSubscription(ctx context.Context, request *v1pb.DeleteUserPushSubscriptionRequest) (*emptypb.Empty, error) {
	user, subscriptionID, err := s.resolveUserAndPushSubscriptionIDFromName(ctx, request.Name)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid push subscription name: %v", err)
	}
	currentUser, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if currentUser == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if currentUser.ID != user.ID {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}
	if err := s.Store.DeleteUserPushSubscription(ctx, &store.DeleteUserPushSubscription{
		ID:     &subscriptionID,
		UserID: &user.ID,
	}); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to delete push subscription: %v", err)
	}
	return &emptypb.Empty{}, nil
}

func (s *APIV1Service) TestUserPushNotification(ctx context.Context, request *v1pb.TestUserPushNotificationRequest) (*emptypb.Empty, error) {
	user, err := s.requireCurrentUserForParent(ctx, request.Parent)
	if err != nil {
		return nil, err
	}
	setting, err := s.getOrCreateWebPushSetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to load web push setting: %v", err)
	}
	if !setting.GetEnabled() {
		return nil, status.Errorf(codes.FailedPrecondition, "web push notifications are disabled")
	}
	subscriptions, err := s.Store.ListUserPushSubscriptions(ctx, &store.FindUserPushSubscription{
		UserID:     &user.ID,
		ActiveOnly: true,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list push subscriptions: %v", err)
	}
	if len(subscriptions) == 0 {
		return nil, status.Errorf(codes.FailedPrecondition, "no active push subscriptions")
	}
	if s.NotificationWebPushSender == nil {
		return nil, status.Errorf(codes.FailedPrecondition, "web push sender is not configured")
	}

	sent := 0
	for _, subscription := range subscriptions {
		if err := s.NotificationWebPushSender.Send(ctx, subscription, &notification.WebPushPayload{
			Title: testPushNotificationTitle,
			Body:  testPushNotificationBody,
			URL:   "/calendar",
			Tag:   "memos-test-notification",
		}, setting); err != nil {
			slog.Warn("Failed to send test push notification", slog.Int("subscription_id", int(subscription.ID)), slog.Any("err", err))
			if notification.ShouldDisablePushSubscription(err) {
				s.disablePushSubscriptionAfterFailure(ctx, subscription)
			}
			continue
		}
		sent++
	}
	if sent == 0 {
		return nil, status.Errorf(codes.Internal, "failed to send test push notification")
	}
	return &emptypb.Empty{}, nil
}

func (s *APIV1Service) requireCurrentUserForParent(ctx context.Context, parent string) (*store.User, error) {
	user, err := s.resolveUserFromName(ctx, parent)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid user name: %v", err)
	}
	currentUser, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if currentUser == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if currentUser.ID != user.ID {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}
	return user, nil
}

func (s *APIV1Service) getOrCreateWebPushSetting(ctx context.Context) (*storepb.InstanceNotificationSetting_WebPushSetting, error) {
	setting, err := s.Store.GetInstanceNotificationSetting(ctx)
	if err != nil {
		return nil, err
	}
	if setting == nil {
		setting = &storepb.InstanceNotificationSetting{}
	}
	webPush := setting.GetWebPush()
	if webPush == nil {
		webPush = &storepb.InstanceNotificationSetting_WebPushSetting{
			Enabled: true,
			Subject: notification.DefaultWebPushSubject(),
		}
		setting.WebPush = webPush
	}
	if webPush.Subject == "" {
		webPush.Subject = notification.DefaultWebPushSubject()
	}
	if webPush.GetVapidPublicKey() == "" || webPush.GetVapidPrivateKey() == "" {
		publicKey, privateKey, err := notification.GenerateWebPushVAPIDKeys()
		if err != nil {
			return nil, errors.Wrap(err, "failed to generate VAPID keys")
		}
		webPush.VapidPublicKey = publicKey
		webPush.VapidPrivateKey = privateKey
	}
	_, err = s.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key:   storepb.InstanceSettingKey_NOTIFICATION,
		Value: &storepb.InstanceSetting_NotificationSetting{NotificationSetting: setting},
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to persist Web Push setting")
	}
	return webPush, nil
}

func (s *APIV1Service) disablePushSubscriptionAfterFailure(ctx context.Context, subscription *store.UserPushSubscription) {
	if subscription == nil {
		return
	}
	if err := s.Store.DisableUserPushSubscription(ctx, &store.DisableUserPushSubscription{ID: &subscription.ID}); err != nil {
		slog.Warn("Failed to disable push subscription after delivery failure", slog.Int("subscription_id", int(subscription.ID)), slog.Any("err", err))
	}
}

func convertUserPushSubscriptionFromStore(user *store.User, subscription *store.UserPushSubscription) *v1pb.UserPushSubscription {
	result := &v1pb.UserPushSubscription{
		Name:      fmt.Sprintf("%s%s%d", BuildUserName(user.Username), pushSubscriptionPathSegment, subscription.ID),
		Endpoint:  subscription.Endpoint,
		P256Dh:    subscription.P256Dh,
		Auth:      subscription.Auth,
		UserAgent: subscription.UserAgent,
	}
	if subscription.CreatedTs != 0 {
		result.CreateTime = timestamppb.New(time.Unix(subscription.CreatedTs, 0))
	}
	if subscription.UpdatedTs != 0 {
		result.UpdateTime = timestamppb.New(time.Unix(subscription.UpdatedTs, 0))
	}
	return result
}

func (s *APIV1Service) resolveUserAndPushSubscriptionIDFromName(ctx context.Context, name string) (*store.User, int32, error) {
	parts := strings.Split(name, "/")
	if len(parts) != 4 || parts[0] != "users" || parts[2] != "pushSubscriptions" {
		return nil, 0, errors.Errorf("invalid resource name format: %s", name)
	}
	user, err := s.resolveUserFromName(ctx, BuildUserName(parts[1]))
	if err != nil {
		return nil, 0, err
	}
	id, err := strconv.ParseInt(parts[3], 10, 32)
	if err != nil {
		return nil, 0, err
	}
	return user, int32(id), nil
}
