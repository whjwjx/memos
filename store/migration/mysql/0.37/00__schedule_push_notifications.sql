-- Store Web Push subscriptions and per-occurrence reminder delivery claims.
CREATE TABLE `user_push_subscription` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `endpoint` VARCHAR(768) NOT NULL,
  `p256dh` VARCHAR(256) NOT NULL,
  `auth` VARCHAR(256) NOT NULL,
  `user_agent` VARCHAR(512) NOT NULL DEFAULT '',
  `last_seen_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `disabled_ts` BIGINT DEFAULT NULL,
  `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE (`endpoint`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE INDEX `idx_user_push_subscription_user_active` ON `user_push_subscription`(`user_id`, `disabled_ts`);

CREATE TABLE `memo_schedule_reminder_delivery` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `memo_id` INT NOT NULL,
  `occurrence_time` BIGINT NOT NULL,
  `reminder_offset_seconds` INT NOT NULL DEFAULT 0,
  `subscription_id` INT NOT NULL,
  `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE (`user_id`, `memo_id`, `occurrence_time`, `reminder_offset_seconds`, `subscription_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`memo_id`) REFERENCES `memo`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`subscription_id`) REFERENCES `user_push_subscription`(`id`) ON DELETE CASCADE
);

CREATE INDEX `idx_memo_schedule_reminder_delivery_memo_time` ON `memo_schedule_reminder_delivery`(`memo_id`, `occurrence_time`);
