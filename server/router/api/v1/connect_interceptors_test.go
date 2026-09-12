package v1

import (
	"context"
	"io"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	storetest "github.com/usememos/memos/store/test"
)

func TestMetadataInterceptorForwardsSecurityHeaders(t *testing.T) {
	interceptor := NewMetadataInterceptor()
	req := connect.NewRequest(&emptypb.Empty{})
	req.Header().Set("Origin", "https://memos.example")
	req.Header().Set("X-Forwarded-Proto", "https")
	req.Header().Set("Forwarded", "for=203.0.113.1;proto=https")

	handler := interceptor.WrapUnary(func(ctx context.Context, _ connect.AnyRequest) (connect.AnyResponse, error) {
		md, ok := metadata.FromIncomingContext(ctx)
		if !ok {
			t.Fatal("expected metadata in context")
		}
		if got := md.Get("origin"); len(got) != 1 || got[0] != "https://memos.example" {
			t.Fatalf("unexpected origin metadata: %v", got)
		}
		if got := md.Get("x-forwarded-proto"); len(got) != 1 || got[0] != "https" {
			t.Fatalf("unexpected x-forwarded-proto metadata: %v", got)
		}
		if got := md.Get("forwarded"); len(got) != 1 || got[0] != "for=203.0.113.1;proto=https" {
			t.Fatalf("unexpected forwarded metadata: %v", got)
		}
		return connect.NewResponse(&emptypb.Empty{}), nil
	})

	if _, err := handler(context.Background(), req); err != nil {
		t.Fatalf("metadata interceptor returned error: %v", err)
	}
}

func TestMetadataInterceptorForwardsSecurityHeadersForStreamingHandlers(t *testing.T) {
	interceptor := NewMetadataInterceptor()
	conn := newFakeStreamingHandlerConn("/memos.api.v1.AIChatService/StreamMessage")
	conn.requestHeader.Set("Origin", "https://memos.example")
	conn.requestHeader.Set("X-Forwarded-Proto", "https")
	conn.requestHeader.Set("Forwarded", "for=203.0.113.1;proto=https")

	handler := interceptor.WrapStreamingHandler(func(ctx context.Context, _ connect.StreamingHandlerConn) error {
		md, ok := metadata.FromIncomingContext(ctx)
		if !ok {
			t.Fatal("expected metadata in context")
		}
		if got := md.Get("origin"); len(got) != 1 || got[0] != "https://memos.example" {
			t.Fatalf("unexpected origin metadata: %v", got)
		}
		if got := md.Get("x-forwarded-proto"); len(got) != 1 || got[0] != "https" {
			t.Fatalf("unexpected x-forwarded-proto metadata: %v", got)
		}
		if got := md.Get("forwarded"); len(got) != 1 || got[0] != "for=203.0.113.1;proto=https" {
			t.Fatalf("unexpected forwarded metadata: %v", got)
		}
		return nil
	})

	if err := handler(context.Background(), conn); err != nil {
		t.Fatalf("metadata interceptor returned error: %v", err)
	}
}

func TestAuthInterceptorAuthenticatesStreamingHandlers(t *testing.T) {
	ctx := context.Background()
	stores := storetest.NewTestingStore(ctx, t)
	defer stores.Close()
	secret := "stream-secret"
	user, err := stores.CreateUser(ctx, &store.User{
		Username:  "stream-user",
		Role:      store.RoleUser,
		RowStatus: store.Normal,
		Email:     "stream-user@example.com",
	})
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	token, _, err := auth.GenerateAccessTokenV2(user.ID, user.Username, string(user.Role), string(user.RowStatus), []byte(secret))
	if err != nil {
		t.Fatalf("failed to generate access token: %v", err)
	}

	conn := newFakeStreamingHandlerConn("/memos.api.v1.AIChatService/StreamMessage")
	conn.requestHeader.Set("Authorization", "Bearer "+token)
	interceptor := NewAuthInterceptor(NewAuthorizer(stores, secret, &profile.Profile{InstanceURL: "https://memos.example"}))

	handler := interceptor.WrapStreamingHandler(func(ctx context.Context, _ connect.StreamingHandlerConn) error {
		if got := auth.GetUserID(ctx); got != user.ID {
			t.Fatalf("unexpected user id in context: got %d, want %d", got, user.ID)
		}
		return nil
	})

	if err := handler(ctx, conn); err != nil {
		t.Fatalf("auth interceptor returned error: %v", err)
	}
}

type fakeStreamingHandlerConn struct {
	spec            connect.Spec
	requestHeader   http.Header
	responseHeader  http.Header
	responseTrailer http.Header
}

func newFakeStreamingHandlerConn(procedure string) *fakeStreamingHandlerConn {
	return &fakeStreamingHandlerConn{
		spec:            connect.Spec{Procedure: procedure},
		requestHeader:   http.Header{},
		responseHeader:  http.Header{},
		responseTrailer: http.Header{},
	}
}

func (c *fakeStreamingHandlerConn) Spec() connect.Spec {
	return c.spec
}

func (*fakeStreamingHandlerConn) Peer() connect.Peer {
	return connect.Peer{}
}

func (*fakeStreamingHandlerConn) Receive(any) error {
	return io.EOF
}

func (c *fakeStreamingHandlerConn) RequestHeader() http.Header {
	return c.requestHeader
}

func (*fakeStreamingHandlerConn) Send(any) error {
	return nil
}

func (c *fakeStreamingHandlerConn) ResponseHeader() http.Header {
	return c.responseHeader
}

func (c *fakeStreamingHandlerConn) ResponseTrailer() http.Header {
	return c.responseTrailer
}
