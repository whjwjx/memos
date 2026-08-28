-- system_setting
CREATE TABLE `system_setting` (
  `name` VARCHAR(256) NOT NULL PRIMARY KEY,
  `value` LONGTEXT NOT NULL,
  `description` TEXT NOT NULL
);

-- user
CREATE TABLE `user` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `created_ts` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_ts` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `row_status` VARCHAR(256) NOT NULL DEFAULT 'NORMAL',
  `username` VARCHAR(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL UNIQUE,
  `role` VARCHAR(256) NOT NULL DEFAULT 'USER',
  `email` VARCHAR(256) NOT NULL DEFAULT '',
  `nickname` VARCHAR(256) NOT NULL DEFAULT '',
  `password_hash` VARCHAR(256) NOT NULL,
  `avatar_url` LONGTEXT NOT NULL,
  `description` VARCHAR(256) NOT NULL DEFAULT ''
);

-- user_setting
CREATE TABLE `user_setting` (
  `user_id` INT NOT NULL,
  `key` VARCHAR(256) NOT NULL,
  `value` LONGTEXT NOT NULL,
  UNIQUE(`user_id`,`key`)
);

-- memo
CREATE TABLE `memo` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `uid` VARCHAR(256) NOT NULL UNIQUE,
  `creator_id` INT NOT NULL,
  `created_ts` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_ts` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `row_status` VARCHAR(256) NOT NULL DEFAULT 'NORMAL',
  `content` TEXT NOT NULL,
  `visibility` VARCHAR(256) NOT NULL DEFAULT 'PRIVATE',
  `pinned` BOOLEAN NOT NULL DEFAULT FALSE,
  `payload` JSON NOT NULL,
  `scheduled_time` BIGINT DEFAULT NULL,
  `scheduled_duration` BIGINT DEFAULT NULL,
  `scheduled_recurrence` JSON DEFAULT NULL
);

-- memo_relation
CREATE TABLE `memo_relation` (
  `memo_id` INT NOT NULL,
  `related_memo_id` INT NOT NULL,
  `type` VARCHAR(256) NOT NULL,
  UNIQUE(`memo_id`,`related_memo_id`,`type`)
);

-- attachment
CREATE TABLE `attachment` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `uid` VARCHAR(256) NOT NULL UNIQUE,
  `creator_id` INT NOT NULL,
  `created_ts` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_ts` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `filename` TEXT NOT NULL,
  `blob` MEDIUMBLOB,
  `type` VARCHAR(256) NOT NULL DEFAULT '',
  `size` INT NOT NULL DEFAULT '0',
  `memo_id` INT DEFAULT NULL,
  `storage_type` VARCHAR(256) NOT NULL DEFAULT '',
  `reference` TEXT NOT NULL DEFAULT (''),
  `payload` TEXT NOT NULL
);

-- idp
CREATE TABLE `idp` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `uid` VARCHAR(256) NOT NULL UNIQUE,
  `name` TEXT NOT NULL,
  `type` TEXT NOT NULL,
  `identifier_filter` VARCHAR(256) NOT NULL DEFAULT '',
  `config` TEXT NOT NULL
);

-- inbox
CREATE TABLE `inbox` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `created_ts` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `sender_id` INT NOT NULL,
  `receiver_id` INT NOT NULL,
  `status` TEXT NOT NULL,
  `message` TEXT NOT NULL
);

-- memo reaction
CREATE TABLE `reaction` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `created_ts` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `creator_id` INT NOT NULL,
  `memo_id` INT NOT NULL,
  `reaction_type` VARCHAR(256) NOT NULL,
  UNIQUE(`creator_id`,`memo_id`,`reaction_type`)
);

-- memo_share
CREATE TABLE `memo_share` (
  `id`         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `uid`        VARCHAR(255) NOT NULL UNIQUE,
  `memo_id`    INT          NOT NULL,
  `creator_id` INT          NOT NULL,
  `created_ts` BIGINT       NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `expires_ts` BIGINT       DEFAULT NULL,
  FOREIGN KEY (`memo_id`) REFERENCES `memo`(`id`) ON DELETE CASCADE
);

CREATE INDEX `idx_memo_share_memo_id` ON `memo_share`(`memo_id`);

-- user_identity
CREATE TABLE `user_identity` (
  `id`         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id`    INT          NOT NULL,
  `provider`   VARCHAR(256) NOT NULL,
  `extern_uid` VARCHAR(256) NOT NULL,
  `created_ts` BIGINT       NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_ts` BIGINT       NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE (`provider`, `extern_uid`),
  UNIQUE (`user_id`, `provider`)
);

CREATE INDEX `idx_user_identity_user_id` ON `user_identity`(`user_id`);

-- agent_reply_task
CREATE TABLE `agent_reply_task` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `memo_id` INT NOT NULL,
  `agent_id` VARCHAR(256) NOT NULL,
  `status` VARCHAR(256) NOT NULL DEFAULT 'PENDING',
  `due_at` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE (`memo_id`, `agent_id`),
  FOREIGN KEY (`memo_id`) REFERENCES `memo`(`id`) ON DELETE CASCADE
);

CREATE INDEX `idx_agent_reply_task_status_due` ON `agent_reply_task`(`status`, `due_at`);

-- memo_tag_task
CREATE TABLE `memo_tag_task` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `memo_id` INT NOT NULL,
  `tagger_id` VARCHAR(256) NOT NULL,
  `status` VARCHAR(256) NOT NULL DEFAULT 'PENDING',
  `due_at` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE (`memo_id`, `tagger_id`),
  FOREIGN KEY (`memo_id`) REFERENCES `memo`(`id`) ON DELETE CASCADE
);

CREATE INDEX `idx_memo_tag_task_status_due` ON `memo_tag_task`(`status`, `due_at`);

-- memo_schedule_occurrence
CREATE TABLE `memo_schedule_occurrence` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `memo_id` INT NOT NULL,
  `occurrence_time` BIGINT NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `completed_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE (`memo_id`, `occurrence_time`),
  FOREIGN KEY (`memo_id`) REFERENCES `memo`(`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_memo_schedule_occurrence_status` CHECK (`status` IN ('DONE'))
);

CREATE INDEX `idx_memo_schedule_occurrence_memo_time` ON `memo_schedule_occurrence`(`memo_id`, `occurrence_time`);

-- conversation stores an AI chat session owned by a single user.
CREATE TABLE `conversation` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `uid` VARCHAR(256) NOT NULL,
  `user_id` INT NOT NULL,
  `title` VARCHAR(512) NOT NULL DEFAULT '',
  `agent_id` VARCHAR(256) NOT NULL DEFAULT '',
  `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  UNIQUE (`uid`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);

CREATE INDEX `idx_conversation_user_updated` ON `conversation`(`user_id`, `updated_ts`);

-- conversation_message stores the turns of a conversation, including tool calls
-- serialized as JSON in the tool_calls column.
CREATE TABLE `conversation_message` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `conversation_id` INT NOT NULL,
  `role` VARCHAR(32) NOT NULL,
  `content` TEXT NOT NULL DEFAULT '',
  `tool_calls` TEXT NOT NULL DEFAULT '',
  `tool_call_id` VARCHAR(256) NOT NULL DEFAULT '',
  `name` VARCHAR(256) NOT NULL DEFAULT '',
  `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_conversation_message_role` CHECK (`role` IN ('system', 'user', 'assistant', 'tool'))
);

CREATE INDEX `idx_conversation_message_conv` ON `conversation_message`(`conversation_id`, `created_ts`);

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
