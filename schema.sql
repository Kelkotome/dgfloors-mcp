-- DG Floors MCP usage log. Apply: npx wrangler d1 execute dgfloors-mcp --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS mcp_calls (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,          -- 'call' (tools/call) or 'init' (initialize handshake)
  tool       TEXT,                   -- tool name for calls
  query      TEXT,                   -- main argument (material / query), truncated
  client     TEXT,                   -- clientInfo.name from initialize, or user-agent
  created_at INTEGER NOT NULL        -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_mcp_created ON mcp_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_tool ON mcp_calls(tool);
