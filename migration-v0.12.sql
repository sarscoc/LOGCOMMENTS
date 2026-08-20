CREATE TABLE IF NOT EXISTS presence (
  room_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  pl_name TEXT NOT NULL,
  pl_icon TEXT NOT NULL DEFAULT '',
  is_typing INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, author_id)
);
CREATE INDEX IF NOT EXISTS idx_presence_room_seen ON presence(room_id, last_seen);
