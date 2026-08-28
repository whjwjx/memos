-- Add recurrence rules and per-occurrence state for scheduled memos.
ALTER TABLE `memo` ADD COLUMN `scheduled_recurrence` JSON DEFAULT NULL;

CREATE TABLE `memo_schedule_occurrence` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `memo_id` INT NOT NULL,
  `occurrence_time` BIGINT NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE (`memo_id`, `occurrence_time`),
  FOREIGN KEY (`memo_id`) REFERENCES `memo`(`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_memo_schedule_occurrence_status` CHECK (`status` IN ('DONE'))
);

CREATE INDEX `idx_memo_schedule_occurrence_memo_time` ON `memo_schedule_occurrence`(`memo_id`, `occurrence_time`);
