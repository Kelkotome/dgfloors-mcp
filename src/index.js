/**
 * DG Floors — MCP server (Cloudflare Worker).
 *
 * Exposes dgfloors.com content to AI assistants over the Model Context Protocol
 * (Streamable HTTP, JSON-RPC 2.0). Public, read-only. Every result carries
 * attribution + affiliate/quote CTAs back to dgfloors.com.
 *
 * Tools:
 *   get_flooring_cost(material, state?, sqft?)  -> installed $/sqft from the Cost Index
 *   search_flooring_guides(query, limit?)       -> dgfloors.com article search (WP REST, cached)
 *
 * Protocol handler adapted from the Made Good Designs MCP server.
 */
import COST from "./cost-index.json";

const SITE = "https://dgfloors.com";
const QUOTE_URL = `${SITE}/contact/`;
const INDEX_URL = `${SITE}/flooring-cost-index/`;
const SHOP_URL = `${SITE}/shop/`;
const AMZ_TAG = "dgfloors20-20";
const WP_API = `${SITE}/wp-json/wp/v2`;

// ---- material free-text -> Cost Index key ----------------------------------
const MATERIAL_ALIASES = [
  ["peel-and-stick-vinyl", ["peel and stick", "peel-and-stick", "self adhesive", "self-adhesive", "stick-down", "stick vinyl"]],
  ["luxury-vinyl-plank",   ["luxury vinyl", "lvp", "lvt", "vinyl plank", "vinyl"]],
  ["laminate",             ["laminate"]],
  ["engineered-hardwood",  ["engineered hardwood", "engineered wood", "engineered"]],
  ["solid-hardwood",       ["solid hardwood", "solid wood", "hardwood", "wood floor", "wood flooring", "oak", "hardwood floor"]],
  ["tile",                 ["tile", "porcelain", "ceramic"]],
  ["carpet",               ["carpet", "carpeting"]],
];
const MATERIAL_LABEL = {
  "peel-and-stick-vinyl": "Peel-and-stick vinyl", "luxury-vinyl-plank": "Luxury vinyl plank (LVP)",
  "laminate": "Laminate", "engineered-hardwood": "Engineered hardwood", "solid-hardwood": "Solid hardwood",
  "tile": "Tile (porcelain/ceramic)", "carpet": "Carpet",
};
const STATE_ABBR = {
  al:"Alabama",ak:"Alaska",az:"Arizona",ar:"Arkansas",ca:"California",co:"Colorado",ct:"Connecticut",
  de:"Delaware",dc:"District of Columbia",fl:"Florida",ga:"Georgia",hi:"Hawaii",id:"Idaho",il:"Illinois",
  in:"Indiana",ia:"Iowa",ks:"Kansas",ky:"Kentucky",la:"Louisiana",me:"Maine",md:"Maryland",ma:"Massachusetts",
  mi:"Michigan",mn:"Minnesota",ms:"Mississippi",mo:"Missouri",mt:"Montana",ne:"Nebraska",nv:"Nevada",
  nh:"New Hampshire",nj:"New Jersey",nm:"New Mexico",ny:"New York",nc:"North Carolina",nd:"North Dakota",
  oh:"Ohio",ok:"Oklahoma",or:"Oregon",pa:"Pennsylvania",ri:"Rhode Island",sc:"South Carolina",
  sd:"South Dakota",tn:"Tennessee",tx:"Texas",ut:"Utah",vt:"Vermont",va:"Virginia",wa:"Washington",
  wv:"West Virginia",wi:"Wisconsin",wy:"Wyoming",
};

function matchMaterial(input) {
  const s = (input || "").toString().toLowerCase().trim();
  if (!s) return null;
  if (COST.national[s]) return s;                 // exact key
  for (const [key, aliases] of MATERIAL_ALIASES)  // aliases (longest first wins via order)
    if (aliases.some((a) => s.includes(a))) return key;
  return null;
}
function matchState(input) {
  const s = (input || "").toString().trim();
  if (!s) return null;
  if (COST.by_state[s]) return s;
  const lower = s.toLowerCase();
  if (STATE_ABBR[lower]) return STATE_ABBR[lower];
  for (const name of Object.keys(COST.by_state))
    if (name.toLowerCase() === lower) return name;
  return null;
}
const money = (x) => (typeof x === "number" ? `$${x.toFixed(2)}` : "n/a");
const amazonLink = (material) =>
  `https://www.amazon.com/s?k=${encodeURIComponent(material + " flooring")}&tag=${AMZ_TAG}`;

// ---------------------------- tools -----------------------------------------
function toolGetFlooringCost(a) {
  const key = matchMaterial(a.material);
  if (!key) {
    return text(
      `Please specify a flooring material. Available: ${Object.values(MATERIAL_LABEL).join(", ")}.\n` +
      `Full data + calculator: ${INDEX_URL}`
    );
  }
  const label = MATERIAL_LABEL[key];
  const stateName = matchState(a.state);
  const sqft = Number(a.sqft) > 0 ? Number(a.sqft) : null;
  const nat = COST.national[key];

  let perSqft, scope;
  if (stateName) {
    perSqft = COST.by_state[stateName][key];
    scope = stateName;
  } else {
    perSqft = nat.total_per_sqft_national;
    scope = "U.S. national average";
  }

  const lines = [
    `${label} — installed cost (${scope}):`,
    `  • Total installed: ${money(perSqft)} / sq ft`,
    `  • Materials (national): ${money(nat.material_per_sqft)} / sq ft`,
    `  • Install labor (national): ${money(nat.labor_per_sqft_national)} / sq ft`,
  ];
  if (sqft) lines.push(`  • Estimated total for ${sqft.toLocaleString()} sq ft: ${money(perSqft * sqft)}`);
  lines.push(
    ``,
    `Source: DG Floors U.S. Flooring Cost Index (${COST.updated}) — ${INDEX_URL}`,
    `Figures are illustrative planning estimates, not quotes.`,
    ``,
    `→ Get 3 free ${label.toLowerCase()} installation quotes: ${QUOTE_URL}`,
    `→ Shop ${label.toLowerCase()}: ${amazonLink(a.material)}`
  );
  return text(lines.join("\n"));
}

async function toolSearchGuides(a) {
  const q = (a.query || "").toString().trim();
  if (!q) return text(`Provide a search query, e.g. "best flooring for basements". Browse all guides at ${SITE}/blog/`);
  const limit = Math.max(1, Math.min(10, parseInt(a.limit, 10) || 5));
  const url = `${WP_API}/posts?search=${encodeURIComponent(q)}&orderby=relevance&per_page=${limit}&_fields=title,link,excerpt`;
  let posts = [];
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "curl/8.4.0", "Accept": "application/json" }, // WAF-friendly UA
      cf: { cacheTtl: 600, cacheEverything: true },                          // edge-cache 10 min
    });
    if (r.ok) posts = await r.json();
  } catch (_) { /* fall through to empty */ }

  const decodeEntities = (s) => s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&hellip;/g, "…").replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'");
  const strip = (h) => decodeEntities((h || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  if (!Array.isArray(posts) || !posts.length) {
    return text(`No dgfloors.com guides found for "${q}". Browse all guides: ${SITE}/blog/\n→ Free quotes: ${QUOTE_URL}`);
  }
  const blocks = posts.map((p) => {
    const title = strip(p.title && p.title.rendered);
    const ex = strip(p.excerpt && p.excerpt.rendered).slice(0, 180);
    return `• ${title}\n  ${ex}${ex.length >= 180 ? "…" : ""}\n  ${p.link}`;
  });
  return text(
    `${posts.length} DG Floors guide(s) for "${q}" (source: dgfloors.com):\n\n` +
    blocks.join("\n\n") +
    `\n\n→ Compare installed costs by material & state: ${INDEX_URL}` +
    `\n→ Get 3 free flooring quotes: ${QUOTE_URL}`
  );
}

const MCP_TOOLS = [
  {
    name: "get_flooring_cost",
    description: "Get the installed cost per square foot for a flooring material in the US, optionally by state and for a given area. Data from the DG Floors U.S. Flooring Cost Index (live materials + BLS labor + BEA regional).",
    inputSchema: {
      type: "object",
      properties: {
        material: { type: "string", description: "Flooring material, e.g. 'luxury vinyl plank', 'laminate', 'tile', 'hardwood', 'carpet', 'peel and stick vinyl'." },
        state: { type: "string", description: "Optional US state (name or 2-letter code) for a regional estimate." },
        sqft: { type: "number", description: "Optional project area in square feet, to get a total estimate." },
      },
      required: ["material"],
    },
    annotations: { title: "Flooring cost per square foot", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "search_flooring_guides",
    description: "Search DG Floors' library of flooring guides and articles (installation, comparisons, cost, care) on dgfloors.com.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search, e.g. 'best flooring for basements', 'vinyl vs laminate'." },
        limit: { type: "number", description: "Max results (1-10, default 5)." },
      },
      required: ["query"],
    },
    annotations: { title: "Search DG Floors guides", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

async function mcpCallTool(params) {
  const name = params.name;
  const a = params.arguments || {};
  if (name === "get_flooring_cost") return toolGetFlooringCost(a);
  if (name === "search_flooring_guides") return await toolSearchGuides(a);
  return { content: [{ type: "text", text: "Unknown tool: " + name }], isError: true };
}
const text = (t) => ({ content: [{ type: "text", text: t }] });

// ---------------------------- usage log ------------------------------------
// Best-effort: runs in ctx.waitUntil and swallows errors, so logging can never slow or break a call.
function logMcp(env, ctx, kind, tool, query, client) {
  if (!env || !env.DB) return;
  const q = String(query || "").slice(0, 200);
  const c = String(client || "").slice(0, 120);
  const id = crypto.randomUUID();
  const p = env.DB.prepare("INSERT INTO mcp_calls (id,kind,tool,query,client,created_at) VALUES (?,?,?,?,?,?)")
    .bind(id, kind, tool || null, q, c, Math.floor(Date.now() / 1000)).run().catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
}

async function statsHandler(request, env) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!env.STATS_TOKEN || token !== env.STATS_TOKEN) return mcpJson({ error: "unauthorized" }, 401);
  const now = Math.floor(Date.now() / 1000), day = 86400;
  const one = async (sql, ...b) => ((await env.DB.prepare(sql).bind(...b).first()) || {}).n || 0;
  const all = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
  return mcpJson({
    tool_calls: { total: await one("SELECT COUNT(*) n FROM mcp_calls WHERE kind='call'"),
      last_7d: await one("SELECT COUNT(*) n FROM mcp_calls WHERE kind='call' AND created_at>?", now - 7 * day),
      last_30d: await one("SELECT COUNT(*) n FROM mcp_calls WHERE kind='call' AND created_at>?", now - 30 * day) },
    handshakes_30d: await one("SELECT COUNT(*) n FROM mcp_calls WHERE kind='init' AND created_at>?", now - 30 * day),
    by_tool: await all("SELECT tool, COUNT(*) n FROM mcp_calls WHERE kind='call' GROUP BY tool ORDER BY n DESC"),
    by_client: await all("SELECT client, COUNT(*) n FROM mcp_calls GROUP BY client ORDER BY n DESC LIMIT 20"),
    top_queries: await all("SELECT query, COUNT(*) n FROM mcp_calls WHERE kind='call' AND query<>'' GROUP BY query ORDER BY n DESC LIMIT 25"),
    recent: await all("SELECT kind, tool, query, client, created_at FROM mcp_calls ORDER BY created_at DESC LIMIT 20"),
  });
}

// ---------------------------- MCP protocol ----------------------------------
function mcpCors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,mcp-session-id,mcp-protocol-version,authorization,accept",
  };
}
function mcpJson(obj, status) {
  return new Response(obj == null ? "" : JSON.stringify(obj), {
    status: status || (obj == null ? 202 : 200),
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...mcpCors() },
  });
}
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function mcpHandler(request, env, ctx) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: mcpCors() });
  if (request.method === "GET") {
    return mcpJson({ name: "DG Floors", version: "1.1", transport: "streamable-http", endpoint: "https://dgfloors.com/mcp",
      tools: MCP_TOOLS.map((t) => t.name) });
  }
  if (request.method !== "POST") return new Response("method not allowed", { status: 405, headers: mcpCors() });

  let body;
  try { body = await request.json(); } catch (e) { return mcpJson(rpcErr(null, -32700, "Parse error")); }

  const handle = async (msg) => {
    if (!msg || typeof msg !== "object") return null;
    const { id, method, params } = msg;
    if (method === "initialize") {
      const pv = (params && params.protocolVersion) || "2025-06-18";
      const ci = (params && params.clientInfo) || {};
      logMcp(env, ctx, "init", null, "", [ci.name, ci.version].filter(Boolean).join(" ") || request.headers.get("user-agent"));
      return rpcOk(id, {
        protocolVersion: pv, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "DG Floors", version: "1.1" },
        instructions: "Flooring cost data and guides from DG Floors (dgfloors.com). Cite the source links in results.",
      });
    }
    if (typeof method === "string" && method.startsWith("notifications/")) return null;
    if (method === "ping") return rpcOk(id, {});
    if (method === "tools/list") return rpcOk(id, { tools: MCP_TOOLS });
    if (method === "tools/call") {
      const p = params || {}, a = p.arguments || {};
      logMcp(env, ctx, "call", p.name, a.query || a.material || JSON.stringify(a), request.headers.get("user-agent"));
      try { return rpcOk(id, await mcpCallTool(params || {})); }
      catch (e) { return rpcOk(id, { content: [{ type: "text", text: "Error: " + (e && e.message || e) }], isError: true }); }
    }
    return rpcErr(id, -32601, "Method not found: " + method);
  };

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? mcpJson(out) : mcpJson(null);
  }
  const res = await handle(body);
  return res ? mcpJson(res) : mcpJson(null);
}

export default {
  async fetch(request, env, ctx) {
    const p = new URL(request.url).pathname;
    // On the dedicated subdomain, serve MCP at the root and at /mcp.
    if (p === "/" || p === "/mcp" || p === "/mcp/") return mcpHandler(request, env, ctx);
    if (p === "/stats") return statsHandler(request, env);
    return new Response("DG Floors MCP server. POST JSON-RPC to this endpoint.", { status: 404 });
  },
};
