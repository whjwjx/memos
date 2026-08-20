-- agent_reply_task queues AI agent replies for newly created memos.
-- One row per (memo_id, agent_id) keeps replies idempotent: a memo can only
-- ever get a single reply from a given agent, even across restarts or when
-- multiple server replicas race to claim the task.
CREATE TABLE agent_reply_task (
  id SERIAL PRIMARY KEY,
  memo_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  due_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  UNIQUE (memo_id, agent_id),
  FOREIGN KEY (memo_id) REFERENCES memo(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_reply_task_status_due ON agent_reply_task(status, due_at);
