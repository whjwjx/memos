-- Store Web Push subscriptions and per-occurrence reminder delivery claims.
CREATE TABLE user_push_subscription (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  last_seen_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  disabled_ts BIGINT DEFAULT NULL,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  UNIQUE (endpoint),
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_push_subscription_user_active ON user_push_subscription(user_id, disabled_ts);

CREATE TABLE memo_schedule_reminder_delivery (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  memo_id INTEGER NOT NULL,
  occurrence_time BIGINT NOT NULL,
  reminder_offset_seconds INTEGER NOT NULL DEFAULT 0,
  subscription_id INTEGER NOT NULL,
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  UNIQUE (user_id, memo_id, occurrence_time, reminder_offset_seconds, subscription_id),
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE,
  FOREIGN KEY (memo_id) REFERENCES memo(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES user_push_subscription(id) ON DELETE CASCADE
);

CREATE INDEX idx_memo_schedule_reminder_delivery_memo_time ON memo_schedule_reminder_delivery(memo_id, occurrence_time);
