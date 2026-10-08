PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cache_entries (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  prompt TEXT NOT NULL,
  normalized_prompt TEXT NOT NULL,
  response_key TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  embedding_model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at INTEGER
);

CREATE TABLE IF NOT EXISTS local_vectors (
  entry_id TEXT PRIMARY KEY,
  dimensions INTEGER NOT NULL,
  embedding_json TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES cache_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cache_entries_namespace_expiry
  ON cache_entries(namespace, embedding_model, expires_at);

