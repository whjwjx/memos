-- Add scheduled_time and scheduled_duration columns to memo.
-- scheduled_time is the Unix epoch seconds when the memo is scheduled to happen.
-- scheduled_duration is the duration in seconds; NULL means a point event.
ALTER TABLE memo ADD COLUMN scheduled_time BIGINT DEFAULT NULL;
ALTER TABLE memo ADD COLUMN scheduled_duration BIGINT DEFAULT NULL;
