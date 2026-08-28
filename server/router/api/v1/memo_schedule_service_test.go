package v1

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestExpandMemoScheduleOccurrencesWeeklyWorkdays(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	require.NoError(t, err)

	scheduledTime := time.Date(2026, 8, 31, 8, 0, 0, 0, loc).Unix() // Monday
	memo := &store.Memo{
		ID:            1,
		ScheduledTime: &scheduledTime,
		ScheduledRecurrence: &store.MemoScheduleRecurrence{
			Frequency:  store.MemoScheduleRecurrenceWeekly,
			DaysOfWeek: []int32{1, 2, 3, 4, 5},
			Interval:   1,
			Timezone:   "Asia/Shanghai",
		},
	}

	occurrences := expandMemoScheduleOccurrences(
		memo,
		time.Date(2026, 8, 31, 0, 0, 0, 0, loc),
		time.Date(2026, 9, 7, 0, 0, 0, 0, loc),
	)

	require.Equal(t, []int64{
		time.Date(2026, 8, 31, 8, 0, 0, 0, loc).Unix(),
		time.Date(2026, 9, 1, 8, 0, 0, 0, loc).Unix(),
		time.Date(2026, 9, 2, 8, 0, 0, 0, loc).Unix(),
		time.Date(2026, 9, 3, 8, 0, 0, 0, loc).Unix(),
		time.Date(2026, 9, 4, 8, 0, 0, 0, loc).Unix(),
	}, occurrences)
}

func TestExpandMemoScheduleOccurrencesDailyKeepsLocalClockAcrossDST(t *testing.T) {
	loc, err := time.LoadLocation("America/New_York")
	require.NoError(t, err)

	scheduledTime := time.Date(2026, 3, 7, 8, 0, 0, 0, loc).Unix()
	memo := &store.Memo{
		ID:            1,
		ScheduledTime: &scheduledTime,
		ScheduledRecurrence: &store.MemoScheduleRecurrence{
			Frequency: store.MemoScheduleRecurrenceDaily,
			Interval:  1,
			Timezone:  "America/New_York",
		},
	}

	occurrences := expandMemoScheduleOccurrences(
		memo,
		time.Date(2026, 3, 7, 0, 0, 0, 0, loc),
		time.Date(2026, 3, 10, 0, 0, 0, 0, loc),
	)

	require.Equal(t, []int64{
		time.Date(2026, 3, 7, 8, 0, 0, 0, loc).Unix(),
		time.Date(2026, 3, 8, 8, 0, 0, 0, loc).Unix(),
		time.Date(2026, 3, 9, 8, 0, 0, 0, loc).Unix(),
	}, occurrences)
}

func TestValidateScheduleRecurrence(t *testing.T) {
	err := validateScheduleRecurrence(&store.MemoScheduleRecurrence{
		Frequency:  store.MemoScheduleRecurrenceWeekly,
		DaysOfWeek: []int32{1, 1},
		Timezone:   "Asia/Shanghai",
	})
	require.Error(t, err)

	err = validateScheduleRecurrence(&store.MemoScheduleRecurrence{
		Frequency: store.MemoScheduleRecurrenceDaily,
		Timezone:  "Asia/Shanghai",
	})
	require.NoError(t, err)
}

func TestCalculateMemoScheduleStatsUsesScheduledDayStreaks(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	require.NoError(t, err)

	occurrenceTimes := []int64{
		time.Date(2026, 8, 24, 8, 0, 0, 0, loc).Unix(),
		time.Date(2026, 8, 25, 8, 0, 0, 0, loc).Unix(),
		time.Date(2026, 8, 26, 8, 0, 0, 0, loc).Unix(),
		time.Date(2026, 8, 27, 8, 0, 0, 0, loc).Unix(),
	}
	doneByOccurrence := map[int64]*store.MemoScheduleOccurrence{
		occurrenceTimes[0]: {Status: store.MemoScheduleOccurrenceDone, CompletedTs: occurrenceTimes[0] + 60},
		occurrenceTimes[2]: {Status: store.MemoScheduleOccurrenceDone, CompletedTs: occurrenceTimes[2] + 60},
		occurrenceTimes[3]: {Status: store.MemoScheduleOccurrenceDone, CompletedTs: occurrenceTimes[3] + 60},
	}

	stats := calculateMemoScheduleStats("memos/streak", &store.MemoScheduleRecurrence{Timezone: "Asia/Shanghai"}, occurrenceTimes, doneByOccurrence)

	require.Equal(t, int32(4), stats.ExpectedCount)
	require.Equal(t, int32(3), stats.CompletedCount)
	require.Equal(t, int32(1), stats.MissedCount)
	require.Equal(t, 0.75, stats.CompletionRate)
	require.Equal(t, int32(2), stats.CurrentStreak)
	require.Equal(t, int32(2), stats.LongestStreak)
	require.Equal(t, occurrenceTimes[3]+60, stats.LastCompletedTime.AsTime().Unix())
}
