-- conversation stores an AI chat session owned by a single user.
CREATE TABLE conversation (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL DEFAULT '',
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX idx_conversation_user_updated ON conversation(user_id, updated_ts);

-- conversation_message stores the turns of a conversation, including tool calls
-- serialized as JSON in the tool_calls column.
CREATE TABLE conversation_message (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
  content TEXT NOT NULL DEFAULT '',
  tool_calls TEXT NOT NULL DEFAULT '',
  created_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  updated_ts BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
  FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE
);

CREATE INDEX idx_conversation_message_conv ON conversation_message(conversation_id, created_ts);
