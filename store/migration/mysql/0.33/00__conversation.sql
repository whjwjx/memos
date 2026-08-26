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
  `created_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  `updated_ts` BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON DELETE CASCADE,
  CONSTRAINT `chk_conversation_message_role` CHECK (`role` IN ('system', 'user', 'assistant', 'tool'))
);

CREATE INDEX `idx_conversation_message_conv` ON `conversation_message`(`conversation_id`, `created_ts`);
