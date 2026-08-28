package v1

import (
	"context"
	"sort"
	"strconv"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/durationpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	"github.com/usememos/memos/store"
)

const maxScheduleOccurrenceRange = 400 * 24 * time.Hour

func validateScheduleRecurrence(recurrence *store.MemoScheduleRecurrence) error {
	if recurrence == nil {
		return nil
	}
	if recurrence.Interval < 0 {
		return status.Errorf(codes.InvalidArgument, "scheduled_recurrence.interval must be non-negative")
	}
	if recurrence.Timezone != "" {
		if _, err := time.LoadLocation(recurrence.Timezone); err != nil {
			return status.Errorf(codes.InvalidArgument, "scheduled_recurrence.timezone is invalid")
		}
	}
	switch recurrence.Frequency {
	case store.MemoScheduleRecurrenceDaily:
		return nil
	case store.MemoScheduleRecurrenceWeekly:
		if len(recurrence.DaysOfWeek) == 0 {
			return status.Errorf(codes.InvalidArgument, "scheduled_recurrence.days_of_week is required for weekly recurrence")
		}
		seen := map[int32]bool{}
		for _, day := range recurrence.DaysOfWeek {
			if day < 0 || day > 6 {
				return status.Errorf(codes.InvalidArgument, "scheduled_recurrence.days_of_week must be between 0 and 6")
			}
			if seen[day] {
				return status.Errorf(codes.InvalidArgument, "scheduled_recurrence.days_of_week contains duplicate values")
			}
			seen[day] = true
		}
		return nil
	default:
		return status.Errorf(codes.InvalidArgument, "scheduled_recurrence.frequency is invalid")
	}
}

func (s *APIV1Service) ListMemoScheduleOccurrences(ctx context.Context, request *v1pb.ListMemoScheduleOccurrencesRequest) (*v1pb.ListMemoScheduleOccurrencesResponse, error) {
	currentUser, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get user")
	}
	if currentUser == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if request.StartTime == nil || !request.StartTime.IsValid() {
		return nil, status.Errorf(codes.InvalidArgument, "start_time is invalid")
	}
	if request.EndTime == nil || !request.EndTime.IsValid() {
		return nil, status.Errorf(codes.InvalidArgument, "end_time is invalid")
	}
	start := request.StartTime.AsTime()
	end := request.EndTime.AsTime()
	if !end.After(start) {
		return nil, status.Errorf(codes.InvalidArgument, "end_time must be after start_time")
	}
	if end.Sub(start) > maxScheduleOccurrenceRange {
		return nil, status.Errorf(codes.InvalidArgument, "time range is too large")
	}

	state := store.Normal
	hasScheduledTime := true
	ownMemos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		RowStatus:        &state,
		ExcludeComments:  true,
		CreatorID:        &currentUser.ID,
		HasScheduledTime: &hasScheduledTime,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list scheduled memos: %v", err)
	}
	visibleMemos, err := s.Store.ListMemos(ctx, &store.FindMemo{
		RowStatus:        &state,
		ExcludeComments:  true,
		VisibilityList:   []store.Visibility{store.Public, store.Protected},
		HasScheduledTime: &hasScheduledTime,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list visible scheduled memos: %v", err)
	}
	memos := mergeMemoListsByID(ownMemos, visibleMemos)

	memoIDs := make([]int32, 0, len(memos))
	for _, memo := range memos {
		memoIDs = append(memoIDs, memo.ID)
	}
	if len(memoIDs) == 0 {
		return &v1pb.ListMemoScheduleOccurrencesResponse{}, nil
	}
	startTs, endTs := start.Unix(), end.Unix()
	occurrenceRows, err := s.Store.ListMemoScheduleOccurrences(ctx, &store.FindMemoScheduleOccurrence{
		MemoIDList: memoIDs,
		TimeAfter:  &startTs,
		TimeBefore: &endTs,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list schedule occurrence state")
	}
	occurrenceByKey := map[string]*store.MemoScheduleOccurrence{}
	for _, occurrence := range occurrenceRows {
		occurrenceByKey[scheduleOccurrenceKey(occurrence.MemoID, occurrence.OccurrenceTime)] = occurrence
	}

	creatorIDs := make([]int32, 0, len(memos))
	for _, memo := range memos {
		creatorIDs = append(creatorIDs, memo.CreatorID)
	}
	creatorMap, err := s.listUsersByID(ctx, creatorIDs)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list memo creators: %v", err)
	}

	response := &v1pb.ListMemoScheduleOccurrencesResponse{}
	for _, memo := range memos {
		memoMessage, err := s.convertMemoFromStoreWithCreators(ctx, memo, nil, nil, []*v1pb.MemoRelation{}, creatorMap)
		if err != nil {
			if errors.Is(err, errMemoCreatorNotFound) {
				continue
			}
			return nil, errors.Wrap(err, "failed to convert memo")
		}
		for _, occurrenceTime := range expandMemoScheduleOccurrences(memo, start, end) {
			response.Occurrences = append(response.Occurrences, convertScheduleOccurrenceFromStoreMemo(
				memo,
				memoMessage,
				occurrenceTime,
				occurrenceByKey[scheduleOccurrenceKey(memo.ID, occurrenceTime)],
			))
		}
	}
	sort.SliceStable(response.Occurrences, func(i, j int) bool {
		left := response.Occurrences[i].OccurrenceTime.AsTime()
		right := response.Occurrences[j].OccurrenceTime.AsTime()
		if left.Equal(right) {
			return response.Occurrences[i].Memo < response.Occurrences[j].Memo
		}
		return left.Before(right)
	})
	return response, nil
}

func (s *APIV1Service) GetMemoScheduleStats(ctx context.Context, request *v1pb.GetMemoScheduleStatsRequest) (*v1pb.MemoScheduleStats, error) {
	memoUID, err := ExtractMemoUIDFromName(request.Memo)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo: %v", err)
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}
	if err := s.checkMemoAndParentReadAccess(ctx, memo); err != nil {
		return nil, err
	}
	if memo.ScheduledTime == nil {
		return nil, status.Errorf(codes.InvalidArgument, "memo has no scheduled_time")
	}
	if request.StartTime == nil || !request.StartTime.IsValid() {
		return nil, status.Errorf(codes.InvalidArgument, "start_time is invalid")
	}
	if request.EndTime == nil || !request.EndTime.IsValid() {
		return nil, status.Errorf(codes.InvalidArgument, "end_time is invalid")
	}
	start := request.StartTime.AsTime()
	end := request.EndTime.AsTime()
	if !end.After(start) {
		return nil, status.Errorf(codes.InvalidArgument, "end_time must be after start_time")
	}
	if end.Sub(start) > maxScheduleOccurrenceRange {
		return nil, status.Errorf(codes.InvalidArgument, "time range is too large")
	}

	cutoff := end
	if now := time.Now(); now.Before(cutoff) {
		cutoff = now
	}
	response := &v1pb.MemoScheduleStats{Memo: request.Memo}
	if !cutoff.After(start) {
		return response, nil
	}

	occurrenceTimes := expandMemoScheduleOccurrences(memo, start, cutoff)
	if len(occurrenceTimes) == 0 {
		return response, nil
	}
	startTs, cutoffTs := start.Unix(), cutoff.Unix()
	rows, err := s.Store.ListMemoScheduleOccurrences(ctx, &store.FindMemoScheduleOccurrence{
		MemoID:     &memo.ID,
		TimeAfter:  &startTs,
		TimeBefore: &cutoffTs,
		StatusList: []store.MemoScheduleOccurrenceStatus{store.MemoScheduleOccurrenceDone},
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list schedule occurrence state")
	}

	doneByOccurrence := map[int64]*store.MemoScheduleOccurrence{}
	for _, row := range rows {
		doneByOccurrence[row.OccurrenceTime] = row
	}
	stats := calculateMemoScheduleStats(request.Memo, memo.ScheduledRecurrence, occurrenceTimes, doneByOccurrence)
	return stats, nil
}

func (s *APIV1Service) UpsertMemoScheduleOccurrence(ctx context.Context, request *v1pb.UpsertMemoScheduleOccurrenceRequest) (*v1pb.MemoScheduleOccurrence, error) {
	memoUID, err := ExtractMemoUIDFromName(request.Memo)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "invalid memo name: %v", err)
	}
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get memo: %v", err)
	}
	if memo == nil {
		return nil, status.Errorf(codes.NotFound, "memo not found")
	}

	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user")
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if memo.CreatorID != user.ID && !isSuperUser(user) {
		return nil, status.Errorf(codes.PermissionDenied, "permission denied")
	}
	if request.OccurrenceTime == nil || !request.OccurrenceTime.IsValid() {
		return nil, status.Errorf(codes.InvalidArgument, "occurrence_time is invalid")
	}
	occurrenceTime := request.OccurrenceTime.AsTime().Unix()
	if !memoHasScheduleOccurrence(memo, occurrenceTime) {
		return nil, status.Errorf(codes.InvalidArgument, "occurrence_time does not match the memo schedule")
	}

	var occurrenceRow *store.MemoScheduleOccurrence
	switch request.Status {
	case v1pb.MemoScheduleOccurrence_PENDING:
		if err := s.Store.DeleteMemoScheduleOccurrence(ctx, &store.DeleteMemoScheduleOccurrence{
			MemoID:         &memo.ID,
			OccurrenceTime: &occurrenceTime,
		}); err != nil {
			return nil, status.Errorf(codes.Internal, "failed to clear schedule occurrence")
		}
	case v1pb.MemoScheduleOccurrence_DONE:
		occurrenceRow, err = s.Store.UpsertMemoScheduleOccurrence(ctx, &store.MemoScheduleOccurrence{
			MemoID:         memo.ID,
			OccurrenceTime: occurrenceTime,
			Status:         convertScheduleOccurrenceStatusToStore(request.Status),
		})
		if err != nil {
			return nil, status.Errorf(codes.Internal, "failed to upsert schedule occurrence")
		}
	default:
		return nil, status.Errorf(codes.InvalidArgument, "status is invalid")
	}

	memoMessage, err := s.convertMemoFromStore(ctx, memo, nil, nil, []*v1pb.MemoRelation{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to convert memo")
	}
	return convertScheduleOccurrenceFromStoreMemo(memo, memoMessage, occurrenceTime, occurrenceRow), nil
}

func convertScheduleOccurrenceFromStoreMemo(memo *store.Memo, memoMessage *v1pb.Memo, occurrenceTime int64, occurrenceRow *store.MemoScheduleOccurrence) *v1pb.MemoScheduleOccurrence {
	status := v1pb.MemoScheduleOccurrence_PENDING
	if occurrenceRow != nil && occurrenceRow.Status == store.MemoScheduleOccurrenceDone {
		status = v1pb.MemoScheduleOccurrence_DONE
	}
	occurrence := &v1pb.MemoScheduleOccurrence{
		Memo:           memoMessage.Name,
		OccurrenceTime: timestamppb.New(time.Unix(occurrenceTime, 0)),
		Status:         status,
		Recurring:      memo.ScheduledRecurrence != nil,
		MemoDetail:     memoMessage,
	}
	if occurrenceRow != nil && occurrenceRow.CompletedTs > 0 {
		occurrence.CompletedTime = timestamppb.New(time.Unix(occurrenceRow.CompletedTs, 0))
	}
	if memo.ScheduledDuration != nil {
		occurrence.ScheduledDuration = durationpb.New(time.Duration(*memo.ScheduledDuration) * time.Second)
	}
	return occurrence
}

func calculateMemoScheduleStats(memoName string, recurrence *store.MemoScheduleRecurrence, occurrenceTimes []int64, doneByOccurrence map[int64]*store.MemoScheduleOccurrence) *v1pb.MemoScheduleStats {
	stats := &v1pb.MemoScheduleStats{
		Memo:          memoName,
		ExpectedCount: int32(len(occurrenceTimes)),
	}
	loc := time.UTC
	if recurrence != nil {
		loc = scheduleLocation(recurrence.Timezone)
	}
	dayDone := map[string]bool{}
	dayOrder := []string{}
	seenDay := map[string]bool{}

	for _, occurrenceTime := range occurrenceTimes {
		dayKey := scheduleLocalDayKey(time.Unix(occurrenceTime, 0).In(loc))
		if !seenDay[dayKey] {
			seenDay[dayKey] = true
			dayOrder = append(dayOrder, dayKey)
		}
		if row, ok := doneByOccurrence[occurrenceTime]; ok && row.Status == store.MemoScheduleOccurrenceDone {
			stats.CompletedCount++
			dayDone[dayKey] = true
			if row.CompletedTs > 0 && (stats.LastCompletedTime == nil || row.CompletedTs > stats.LastCompletedTime.AsTime().Unix()) {
				stats.LastCompletedTime = timestamppb.New(time.Unix(row.CompletedTs, 0))
			}
		}
	}
	stats.MissedCount = stats.ExpectedCount - stats.CompletedCount
	if stats.ExpectedCount > 0 {
		stats.CompletionRate = float64(stats.CompletedCount) / float64(stats.ExpectedCount)
	}

	current := int32(0)
	longest := int32(0)
	for _, dayKey := range dayOrder {
		if dayDone[dayKey] {
			current++
			if current > longest {
				longest = current
			}
			continue
		}
		current = 0
	}
	stats.CurrentStreak = current
	stats.LongestStreak = longest
	return stats
}

func convertScheduleOccurrenceStatusToStore(status v1pb.MemoScheduleOccurrence_Status) store.MemoScheduleOccurrenceStatus {
	switch status {
	case v1pb.MemoScheduleOccurrence_DONE:
		return store.MemoScheduleOccurrenceDone
	default:
		return ""
	}
}

func expandMemoScheduleOccurrences(memo *store.Memo, start, end time.Time) []int64 {
	if memo.ScheduledTime == nil {
		return nil
	}
	if memo.ScheduledRecurrence == nil {
		if *memo.ScheduledTime >= start.Unix() && *memo.ScheduledTime < end.Unix() {
			return []int64{*memo.ScheduledTime}
		}
		return nil
	}

	loc := scheduleLocation(memo.ScheduledRecurrence.Timezone)
	base := time.Unix(*memo.ScheduledTime, 0).In(loc)
	startLocal := start.In(loc)
	endLocal := end.In(loc)
	day := time.Date(startLocal.Year(), startLocal.Month(), startLocal.Day(), 0, 0, 0, 0, loc)
	lastDay := time.Date(endLocal.Year(), endLocal.Month(), endLocal.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 1)
	occurrences := []int64{}
	for day.Before(lastDay) {
		occurrence := time.Date(day.Year(), day.Month(), day.Day(), base.Hour(), base.Minute(), base.Second(), 0, loc)
		occurrenceTs := occurrence.Unix()
		if occurrenceTs >= start.Unix() && occurrenceTs < end.Unix() && memoScheduleRecurrenceMatches(memo.ScheduledRecurrence, base, occurrence) {
			occurrences = append(occurrences, occurrenceTs)
		}
		day = day.AddDate(0, 0, 1)
	}
	return occurrences
}

func memoHasScheduleOccurrence(memo *store.Memo, occurrenceTime int64) bool {
	for _, candidate := range expandMemoScheduleOccurrences(memo, time.Unix(occurrenceTime, 0).Add(-24*time.Hour), time.Unix(occurrenceTime, 0).Add(24*time.Hour)) {
		if candidate == occurrenceTime {
			return true
		}
	}
	return false
}

func memoScheduleRecurrenceMatches(recurrence *store.MemoScheduleRecurrence, base, occurrence time.Time) bool {
	if occurrence.Before(base) {
		return false
	}
	if recurrence.Until != nil && occurrence.Unix() > *recurrence.Until {
		return false
	}
	interval := recurrence.Interval
	if interval <= 0 {
		interval = 1
	}
	switch recurrence.Frequency {
	case store.MemoScheduleRecurrenceDaily:
		return daysBetween(base, occurrence)%int(interval) == 0
	case store.MemoScheduleRecurrenceWeekly:
		if !containsWeekday(recurrence.DaysOfWeek, int32(occurrence.Weekday())) {
			return false
		}
		return weeksBetween(base, occurrence)%int(interval) == 0
	default:
		return false
	}
}

func scheduleLocation(timezone string) *time.Location {
	if timezone == "" {
		return time.UTC
	}
	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return time.UTC
	}
	return loc
}

func containsWeekday(days []int32, weekday int32) bool {
	for _, day := range days {
		if day == weekday {
			return true
		}
	}
	return false
}

func daysBetween(start, end time.Time) int {
	startDate := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	endDate := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, time.UTC)
	return int(endDate.Sub(startDate) / (24 * time.Hour))
}

func weeksBetween(start, end time.Time) int {
	startWeek := time.Date(start.Year(), start.Month(), start.Day()-int(start.Weekday()), 0, 0, 0, 0, time.UTC)
	endWeek := time.Date(end.Year(), end.Month(), end.Day()-int(end.Weekday()), 0, 0, 0, 0, time.UTC)
	return int(endWeek.Sub(startWeek) / (7 * 24 * time.Hour))
}

func scheduleLocalDayKey(t time.Time) string {
	return t.Format("2006-01-02")
}

func mergeMemoListsByID(lists ...[]*store.Memo) []*store.Memo {
	memos := []*store.Memo{}
	seen := map[int32]bool{}
	for _, list := range lists {
		for _, memo := range list {
			if seen[memo.ID] {
				continue
			}
			seen[memo.ID] = true
			memos = append(memos, memo)
		}
	}
	return memos
}

func scheduleOccurrenceKey(memoID int32, occurrenceTime int64) string {
	return strconv.FormatInt(int64(memoID), 10) + ":" + strconv.FormatInt(occurrenceTime, 10)
}
