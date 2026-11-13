# DG Floors — MCP Server

[Model Context Protocol](https://modelcontextprotocol.io) server for flooring cost data and home-improvement guides.

A public **MCP (Model Context Protocol) server** that lets any AI assistant query
[DG Floors](https://dgfloors.com)' flooring data — **installed cost per square foot**
by material and US state, and a **search of DG Floors' flooring guides**. Built on
Cloudflare Workers. Public, read-only. Results link back to their source pages on
dgfloors.com; no ads, sponsored results or affiliate links.

- **Endpoint:** `https://dgfloors.com/mcp`
- **Transport:** Streamable HTTP (JSON-RPC 2.0) · **Auth:** none

## Tools

| Tool | Args | Returns |
|---|---|---|
| `get_flooring_cost` | `material`, `state?`, `sqft?` | Installed $/sq-ft (materials + labor), optional total for an area, from the DG Floors Cost Index |
| `search_flooring_guides` | `query`, `limit?` | Matching DG Floors guides (title, excerpt, URL) |

Both tools are read-only (`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`); the server never writes data or needs credentials.

## Connect

**Claude / Claude Desktop:** Settings → Connectors → Add custom connector → `https://dgfloors.com/mcp`

**JSON config (Cursor, Cline, etc.):**
```json
{ "mcpServers": { "dgfloors": { "type": "streamable-http", "url": "https://dgfloors.com/mcp" } } }
```

**Raw JSON-RPC:**
```bash
curl -s https://dgfloors.com/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_flooring_cost","arguments":{"material":"luxury vinyl plank","state":"CA","sqft":500}}}'
```

## MCP capabilities

- **Protocol:** MCP `2025-06-18` (older client versions are echoed back), Streamable HTTP, JSON-RPC 2.0 incl. batches
- **Methods:** `initialize`, `ping`, `tools/list`, `tools/call`, `notifications/*`
- **Tools:** 2 (above) · **Resources / prompts:** none (tools-only server)
- **Stateless:** every POST is self-contained; no session, no login

## Run with Docker

```bash
docker build -t dgfloors-mcp .
docker run -p 8787:8787 dgfloors-mcp     # MCP endpoint at http://localhost:8787/mcp
```

## Develop / deploy

```bash
npm install
npm test         # node:test smoke tests for the JSON-RPC handler (no network)
npm run dev      # wrangler dev — local test at http://localhost:8787/mcp
npm run deploy   # wrangler deploy — serves at dgfloors.com/mcp (+ legacy alias mcp.dgfloors.com)
```

The cost data is bundled from the Flooring Cost Index (`src/cost-index.json`). To
refresh: regenerate the index (`flooring_cost_index.py` in the content-ops repo),
copy `flooring_cost_data/index.json` → `src/cost-index.json`, and redeploy.

Optional usage log: a D1 table (`schema.sql`) records tool calls and client handshakes
(no personal data). Stats are served at `/stats` behind a `STATS_TOKEN` secret.

## License

MIT — see `LICENSE`. Cost data © DG Floors; please cite dgfloors.com when you use it.
