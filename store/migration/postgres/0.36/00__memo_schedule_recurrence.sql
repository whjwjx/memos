-- Add recurrence rules and per-occurrence state for scheduled memos.
ALTER TABLE memo ADD COLUMN scheduled_recurrence JSONB DEFAULT NULL;

CREATE TABLE memo_schedule_occurrence (
  id SERIAL PRIMARY KEY,
  memo_id INTEGER NOT NULL,
  occurrence_time BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DONE')),
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  UNIQUE (memo_id, occurrence_time),
  FOREIGN KEY (memo_id) REFERENCES memo(id) ON DELETE CASCADE
);

CREATE INDEX idx_memo_schedule_occurrence_memo_time ON memo_schedule_occurrence(memo_id, occurrence_time);
