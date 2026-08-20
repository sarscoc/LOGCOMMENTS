CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  log_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  admin_token TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  end_message_id TEXT NOT NULL DEFAULT '',
  parent_id TEXT NOT NULL DEFAULT '',
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  quote TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'yellow',
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  persona_name TEXT NOT NULL,
  persona_type TEXT NOT NULL,
  persona_icon TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  image_data TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_annotations_room_created
ON annotations(room_id, created_at);

CREATE TABLE IF NOT EXISTS annotation_likes (
  annotation_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (annotation_id, author_id)
);

CREATE TABLE IF NOT EXISTS presence (
  room_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  pl_name TEXT NOT NULL,
  pl_icon TEXT NOT NULL DEFAULT '',
  is_typing INTEGER NOT NULL DEFAULT 0,
  typing_name TEXT NOT NULL DEFAULT '',
  typing_icon TEXT NOT NULL DEFAULT '',
  typing_message_id TEXT NOT NULL DEFAULT '',
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, author_id)
);
CREATE INDEX IF NOT EXISTS idx_presence_room_seen ON presence(room_id, last_seen);

CREATE TABLE IF NOT EXISTS room_log_chunks (
  room_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  messages_json TEXT NOT NULL,
  PRIMARY KEY (room_id, chunk_index),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);
