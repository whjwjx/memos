-- Record when a scheduled occurrence was completed.
ALTER TABLE memo_schedule_occurrence ADD COLUMN completed_ts BIGINT NOT NULL DEFAULT 0;
UPDATE memo_schedule_occurrence SET completed_ts = updated_ts WHERE completed_ts = 0;
