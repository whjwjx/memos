-- memo_tag_task queues AI auto-tagging jobs for memos.
-- One row per (memo_id, tagger_id) keeps tagging idempotent: a memo is tagged
-- at most once per tagger, even across restarts or when multiple server
-- replicas race to claim the task. Tagging is additive — applied tags are
-- appended to the memo content and never overwrite user-authored tags.
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
