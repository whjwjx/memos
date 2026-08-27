-- translation_history stores AI translation results owned by a single user.
CREATE TABLE `translation_history` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `uid` VARCHAR(256) NOT NULL,
  `user_id` INT NOT NULL,
  `source_text` TEXT NOT NULL,
  `translated_text` TEXT NOT NULL,
  `source_language` VARCHAR(32) NOT NULL DEFAULT '',
  `target_language` VARCHAR(32) NOT NULL DEFAULT '',
  `provider_id` VARCHAR(256) NOT NULL DEFAULT '',
  `model` VARCHAR(256) NOT NULL DEFAULT '',
  `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE (`uid`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE INDEX `idx_translation_history_user_created` ON `translation_history`(`user_id`, `created_ts`);
