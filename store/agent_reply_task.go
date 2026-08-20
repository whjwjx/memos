package store

import "context"

// AgentReplyTaskStatus is the lifecycle state of a queued agent reply.
type AgentReplyTaskStatus string

const (
	// AgentReplyTaskPending means the task is waiting for its due_at to elapse.
	AgentReplyTaskPending AgentReplyTaskStatus = "PENDING"
	// AgentReplyTaskDone means the agent reply was generated and posted.
	AgentReplyTaskDone AgentReplyTaskStatus = "DONE"
	// AgentReplyTaskFailed means the agent reply generation failed permanently.
	AgentReplyTaskFailed AgentReplyTaskStatus = "FAILED"
)

// AgentReplyTask is a queued AI agent reply for a created memo.
// One row per (MemoID, AgentID) guarantees a memo receives at most one reply
// from a given agent, providing idempotency across restarts and replicas.
type AgentReplyTask struct {
	ID int32

	// Standard fields
	CreatedTs int64
	UpdatedTs int64

	// Domain specific fields
	MemoID  int32
	AgentID string
	Status  AgentReplyTaskStatus
	// DueAt is the unix timestamp (seconds) before which the task must not run.
	DueAt int64
}

// CreateAgentReplyTask is the input for scheduling a new agent reply.
type CreateAgentReplyTask struct {
	MemoID  int32
	AgentID string
	DueAt   int64
}

// FindAgentReplyTask filters queued agent replies.
type FindAgentReplyTask struct {
	ID     *int32
	MemoID *int32
	// StatusList restricts results to the given statuses. Empty means all.
	StatusList []AgentReplyTaskStatus
	// DueBefore, when set, restricts to tasks whose DueAt is <= this unix ts.
	DueBefore *int64
	Limit     *int
}

// UpdateAgentReplyTask mutates a queued task, typically to flip its status.
type UpdateAgentReplyTask struct {
	ID     int32
	Status *AgentReplyTaskStatus
	DueAt  *int64
}

// UpsertAgentReplyTask inserts a task or, if (memo_id, agent_id) already exists,
// leaves the existing row untouched. It returns the resulting task.
func (s *Store) UpsertAgentReplyTask(ctx context.Context, create *CreateAgentReplyTask) (*AgentReplyTask, error) {
	return s.driver.UpsertAgentReplyTask(ctx, create)
}

// ListAgentReplyTasks returns queued tasks matching the filter.
func (s *Store) ListAgentReplyTasks(ctx context.Context, find *FindAgentReplyTask) ([]*AgentReplyTask, error) {
	return s.driver.ListAgentReplyTasks(ctx, find)
}

// UpdateAgentReplyTask applies a partial update to a queued task.
func (s *Store) UpdateAgentReplyTask(ctx context.Context, update *UpdateAgentReplyTask) error {
	return s.driver.UpdateAgentReplyTask(ctx, update)
}
