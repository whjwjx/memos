package v1

import (
	"fmt"
	"sync"
	"time"

	"google.golang.org/protobuf/proto"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
)

const userStatsCacheTTL = 30 * time.Second

type userStatsCache struct {
	mu             sync.Mutex
	userStats      map[string]userStatsCacheEntry[*v1pb.UserStats]
	allUserStats   map[string]userStatsCacheEntry[*v1pb.ListAllUserStatsResponse]
	profileStats   map[string]userStatsCacheEntry[*v1pb.UserProfileStats]
	lastInvalidate time.Time
}

type userStatsCacheEntry[T proto.Message] struct {
	value   T
	expiry  time.Time
	version time.Time
}

func newUserStatsCache() *userStatsCache {
	return &userStatsCache{
		userStats:      make(map[string]userStatsCacheEntry[*v1pb.UserStats]),
		allUserStats:   make(map[string]userStatsCacheEntry[*v1pb.ListAllUserStatsResponse]),
		profileStats:   make(map[string]userStatsCacheEntry[*v1pb.UserProfileStats]),
		lastInvalidate: time.Now(),
	}
}

func makeUserStatsCacheKey(viewerID int32, name string) string {
	return fmt.Sprintf("viewer=%d;name=%s", viewerID, name)
}

func makeAllUserStatsCacheKey(viewerID int32, request *v1pb.ListAllUserStatsRequest) string {
	return fmt.Sprintf("viewer=%d;state=%d;filter=%s", viewerID, request.State, request.Filter)
}

func makeUserProfileStatsCacheKey(viewerID int32, name string, includesAll bool) string {
	return fmt.Sprintf("viewer=%d;name=%s;includesAll=%t", viewerID, name, includesAll)
}

func (c *userStatsCache) getUserStats(key string) (*v1pb.UserStats, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, ok := c.userStats[key]
	if !ok || time.Now().After(entry.expiry) || entry.version.Before(c.lastInvalidate) {
		return nil, false
	}
	return proto.Clone(entry.value).(*v1pb.UserStats), true
}

func (c *userStatsCache) setUserStats(key string, value *v1pb.UserStats) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.userStats[key] = userStatsCacheEntry[*v1pb.UserStats]{
		value:   proto.Clone(value).(*v1pb.UserStats),
		expiry:  time.Now().Add(userStatsCacheTTL),
		version: c.lastInvalidate,
	}
}

func (c *userStatsCache) getAllUserStats(key string) (*v1pb.ListAllUserStatsResponse, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, ok := c.allUserStats[key]
	if !ok || time.Now().After(entry.expiry) || entry.version.Before(c.lastInvalidate) {
		return nil, false
	}
	return proto.Clone(entry.value).(*v1pb.ListAllUserStatsResponse), true
}

func (c *userStatsCache) setAllUserStats(key string, value *v1pb.ListAllUserStatsResponse) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.allUserStats[key] = userStatsCacheEntry[*v1pb.ListAllUserStatsResponse]{
		value:   proto.Clone(value).(*v1pb.ListAllUserStatsResponse),
		expiry:  time.Now().Add(userStatsCacheTTL),
		version: c.lastInvalidate,
	}
}

func (c *userStatsCache) getUserProfileStats(key string) (*v1pb.UserProfileStats, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, ok := c.profileStats[key]
	if !ok || time.Now().After(entry.expiry) || entry.version.Before(c.lastInvalidate) {
		return nil, false
	}
	return proto.Clone(entry.value).(*v1pb.UserProfileStats), true
}

func (c *userStatsCache) setUserProfileStats(key string, value *v1pb.UserProfileStats) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.profileStats[key] = userStatsCacheEntry[*v1pb.UserProfileStats]{
		value:   proto.Clone(value).(*v1pb.UserProfileStats),
		expiry:  time.Now().Add(userStatsCacheTTL),
		version: c.lastInvalidate,
	}
}

func (c *userStatsCache) invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lastInvalidate = time.Now()
	clear(c.userStats)
	clear(c.allUserStats)
	clear(c.profileStats)
}

func (s *APIV1Service) invalidateUserStatsCache() {
	if s.userStatsCache != nil {
		s.userStatsCache.invalidate()
	}
}
