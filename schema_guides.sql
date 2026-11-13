-- Guide search index for search_flooring_guides. Loaded by build_guides_index.py (sql step).
CREATE TABLE IF NOT EXISTS guides (
  id       INTEGER PRIMARY KEY,   -- WP post id
  url      TEXT NOT NULL,
  title    TEXT NOT NULL,
  excerpt  TEXT,
  category TEXT
);
-- External-content FTS5 over guides; rebuilt in full after each load (no triggers needed).
CREATE VIRTUAL TABLE IF NOT EXISTS guides_fts USING fts5(
  title, category, excerpt,
  content='guides', content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2', prefix='2 3'
);
