-- Record when a scheduled occurrence was completed.
ALTER TABLE `memo_schedule_occurrence` ADD COLUMN `completed_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()) AFTER `status`;
