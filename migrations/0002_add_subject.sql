ALTER TABLE cache_entries ADD COLUMN subject TEXT NOT NULL DEFAULT 'general';
CREATE INDEX IF NOT EXISTS idx_cache_entries_subject_expiry
  ON cache_entries(namespace, subject, embedding_model, expires_at);
