-- 2026-11-13: hashed visitor id for device counts (no raw IP stored). Apply once:
--   npx wrangler d1 execute dgfloors-mcp --remote -y --file=migrate_visitor.sql
ALTER TABLE mcp_calls ADD COLUMN visitor TEXT;
CREATE INDEX IF NOT EXISTS idx_mcp_visitor ON mcp_calls(visitor, created_at);
