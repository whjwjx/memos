package store

import "context"

// MemoTagTaskStatus is the lifecycle state of a queued memo auto-tagging task.
type MemoTagTaskStatus string

const (
	// MemoTagTaskPending means the task is waiting for its due_at to elapse.
	MemoTagTaskPending MemoTagTaskStatus = "PENDING"
	// MemoTagTaskDone means the memo was auto-tagged successfully.
	MemoTagTaskDone MemoTagTaskStatus = "DONE"
	// MemoTagTaskFailed means the auto-tagging generation failed permanently.
	MemoTagTaskFailed MemoTagTaskStatus = "FAILED"
)

// MemoTagTask is a queued AI auto-tagging job for a memo.
// One row per (MemoID, TaggerID) guarantees a memo is tagged at most once per
// tagger, providing idempotency across restarts and replicas. Tagging is
// additive: applied tags are appended to the memo content and never overwrite
// user-authored tags.
type MemoTagTask struct {
	ID int32

	// Standard fields
	CreatedTs int64
	UpdatedTs int64

	// Domain specific fields
	MemoID   int32
	TaggerID string
	Status   MemoTagTaskStatus
	// DueAt is the unix timestamp (seconds) before which the task must not run.
	DueAt int64
}

// CreateMemoTagTask is the input for scheduling a new auto-tagging task.
type CreateMemoTagTask struct {
	MemoID   int32
	TaggerID string
	DueAt    int64
	// Force re-arms a finished (DONE/FAILED) task back to PENDING. Used by the
	// manual AutoTagMemo action so a user can re-tag a memo after removing the
	// previously applied tags. When false, an existing completed task keeps its
	// status (idempotent scheduling on memo creation).
	Force bool
}

// FindMemoTagTask filters queued auto-tagging tasks.
type FindMemoTagTask struct {
	ID     *int32
	MemoID *int32
	// StatusList restricts results to the given statuses. Empty means all.
	StatusList []MemoTagTaskStatus
	// DueBefore, when set, restricts to tasks whose DueAt is <= this unix ts.
	DueBefore *int64
	Limit     *int
}

// UpdateMemoTagTask mutates a queued task, typically to flip its status.
type UpdateMemoTagTask struct {
	ID     int32
	Status *MemoTagTaskStatus
	DueAt  *int64
}

// UpsertMemoTagTask inserts a task or, if (memo_id, tagger_id) already exists,
// leaves the existing row untouched. It returns the resulting task.
func (s *Store) UpsertMemoTagTask(ctx context.Context, create *CreateMemoTagTask) (*MemoTagTask, error) {
	return s.driver.UpsertMemoTagTask(ctx, create)
}

// ListMemoTagTasks returns queued tasks matching the filter.
func (s *Store) ListMemoTagTasks(ctx context.Context, find *FindMemoTagTask) ([]*MemoTagTask, error) {
	return s.driver.ListMemoTagTasks(ctx, find)
}

// UpdateMemoTagTask applies a partial update to a queued task.
func (s *Store) UpdateMemoTagTask(ctx context.Context, update *UpdateMemoTagTask) error {
	return s.driver.UpdateMemoTagTask(ctx, update)
}
