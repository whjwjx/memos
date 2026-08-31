package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/pkg/errors"
)

// MemoScheduleRecurrenceFrequency is the cadence for a recurring scheduled memo.
type MemoScheduleRecurrenceFrequency string

const (
	// MemoScheduleRecurrenceDaily repeats a scheduled memo every day.
	MemoScheduleRecurrenceDaily MemoScheduleRecurrenceFrequency = "DAILY"
	// MemoScheduleRecurrenceWeekly repeats a scheduled memo on selected weekdays.
	MemoScheduleRecurrenceWeekly MemoScheduleRecurrenceFrequency = "WEEKLY"
	// MemoScheduleRecurrenceYearly repeats a scheduled memo every year.
	MemoScheduleRecurrenceYearly MemoScheduleRecurrenceFrequency = "YEARLY"
)

// MemoScheduleRecurrence stores the repeat rule for a scheduled memo.
type MemoScheduleRecurrence struct {
	Frequency  MemoScheduleRecurrenceFrequency `json:"frequency"`
	DaysOfWeek []int32                         `json:"daysOfWeek,omitempty"`
	Interval   int32                           `json:"interval,omitempty"`
	Until      *int64                          `json:"until,omitempty"`
	Timezone   string                          `json:"timezone,omitempty"`
}

// MemoScheduleOccurrenceStatus is the persisted state for a single schedule occurrence.
type MemoScheduleOccurrenceStatus string

const (
	// MemoScheduleOccurrenceDone means this occurrence was completed.
	MemoScheduleOccurrenceDone MemoScheduleOccurrenceStatus = "DONE"
)

// MemoScheduleOccurrence stores completion state for one scheduled memo occurrence.
type MemoScheduleOccurrence struct {
	ID int32

	// Standard fields
	CreatedTs   int64
	UpdatedTs   int64
	CompletedTs int64

	// Domain specific fields
	MemoID         int32
	OccurrenceTime int64
	Status         MemoScheduleOccurrenceStatus
}

// FindMemoScheduleOccurrence filters occurrence state rows.
type FindMemoScheduleOccurrence struct {
	ID         *int32
	MemoID     *int32
	MemoIDList []int32
	TimeAfter  *int64
	TimeBefore *int64
	StatusList []MemoScheduleOccurrenceStatus
}

// DeleteMemoScheduleOccurrence deletes occurrence state rows.
type DeleteMemoScheduleOccurrence struct {
	ID             *int32
	MemoID         *int32
	OccurrenceTime *int64
}

// MarshalMemoScheduleRecurrence serializes a recurrence rule for database storage.
func MarshalMemoScheduleRecurrence(recurrence *MemoScheduleRecurrence) (string, error) {
	if recurrence == nil {
		return "", nil
	}
	b, err := json.Marshal(recurrence)
	if err != nil {
		return "", errors.Wrap(err, "failed to marshal memo schedule recurrence")
	}
	return string(b), nil
}

// UnmarshalMemoScheduleRecurrence deserializes a recurrence rule from database storage.
func UnmarshalMemoScheduleRecurrence(raw string) (*MemoScheduleRecurrence, error) {
	if raw == "" {
		return nil, nil
	}
	recurrence := &MemoScheduleRecurrence{}
	if err := json.Unmarshal([]byte(raw), recurrence); err != nil {
		return nil, errors.Wrap(err, "failed to unmarshal memo schedule recurrence")
	}
	return recurrence, nil
}

// UpsertMemoScheduleOccurrence creates or updates a single occurrence state.
func (s *Store) UpsertMemoScheduleOccurrence(ctx context.Context, upsert *MemoScheduleOccurrence) (*MemoScheduleOccurrence, error) {
	if upsert.CompletedTs == 0 {
		upsert.CompletedTs = time.Now().Unix()
	}
	return s.driver.UpsertMemoScheduleOccurrence(ctx, upsert)
}

// ListMemoScheduleOccurrences returns occurrence state rows matching the filter.
func (s *Store) ListMemoScheduleOccurrences(ctx context.Context, find *FindMemoScheduleOccurrence) ([]*MemoScheduleOccurrence, error) {
	return s.driver.ListMemoScheduleOccurrences(ctx, find)
}

// DeleteMemoScheduleOccurrence removes occurrence state rows.
func (s *Store) DeleteMemoScheduleOccurrence(ctx context.Context, delete *DeleteMemoScheduleOccurrence) error {
	return s.driver.DeleteMemoScheduleOccurrence(ctx, delete)
}
