CREATE TABLE memo_schedule_reminder_inbox_delivery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  memo_id INTEGER NOT NULL,
  occurrence_time BIGINT NOT NULL,
  reminder_offset_seconds INTEGER NOT NULL DEFAULT 0,
  created_ts BIGINT NOT NULL DEFAULT (strftime('%s', 'now')),
  UNIQUE(user_id, memo_id, occurrence_time, reminder_offset_seconds),
  FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
  FOREIGN KEY (memo_id) REFERENCES memo(id) ON DELETE CASCADE
);

CREATE INDEX idx_memo_schedule_reminder_inbox_delivery_memo_time ON memo_schedule_reminder_inbox_delivery(memo_id, occurrence_time);
