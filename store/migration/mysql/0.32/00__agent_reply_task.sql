-- agent_reply_task queues AI agent replies for newly created memos.
-- One row per (memo_id, agent_id) keeps replies idempotent: a memo can only
-- ever get a single reply from a given agent, even across restarts or when
-- multiple server replicas race to claim the task.
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
