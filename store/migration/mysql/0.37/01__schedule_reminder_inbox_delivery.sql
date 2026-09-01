CREATE TABLE `memo_schedule_reminder_inbox_delivery` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `memo_id` INT NOT NULL,
  `occurrence_time` BIGINT NOT NULL,
  `reminder_offset_seconds` INT NOT NULL DEFAULT 0,
  `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE (`user_id`, `memo_id`, `occurrence_time`, `reminder_offset_seconds`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`memo_id`) REFERENCES `memo`(`id`) ON DELETE CASCADE
);

CREATE INDEX `idx_memo_schedule_reminder_inbox_delivery_memo_time` ON `memo_schedule_reminder_inbox_delivery`(`memo_id`, `occurrence_time`);
