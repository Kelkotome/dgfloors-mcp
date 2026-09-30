// Smoke tests for the MCP JSON-RPC handler. Run: npm test (Node 20+).
// The Worker imports cost-index.json without an import attribute (fine for wrangler),
// so the test loads a temp copy of the source with `with { type: "json" }` added.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const code = readFileSync(join(src, "index.js"), "utf8").replace(
  'import COST from "./cost-index.json";',
  `import COST from ${JSON.stringify(pathToFileURL(join(src, "cost-index.json")).href)} with { type: "json" };`
);
const tmp = join(src, ".index.test.mjs");
writeFileSync(tmp, code);
const worker = (await import(pathToFileURL(tmp).href)).default;
after(() => rmSync(tmp, { force: true }));

const rpc = async (method, params = {}) => {
  const res = await worker.fetch(new Request("https://dgfloors.com/mcp", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), {}, { waitUntil() {} });
  assert.equal(res.status, 200);
  return res.json();
};

test("initialize returns server info", async () => {
  const r = await rpc("initialize", { protocolVersion: "2025-06-18" });
  assert.equal(r.result.serverInfo.name, "DG Floors");
  assert.ok(r.result.capabilities.tools);
});

test("tools/list exposes read-only annotated tools", async () => {
  const { result } = await rpc("tools/list");
  const names = result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_flooring_cost", "search_flooring_guides"]);
  for (const t of result.tools) {
    assert.equal(t.inputSchema.type, "object");
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.annotations.destructiveHint, false);
  }
});

test("get_flooring_cost answers from the bundled Cost Index", async () => {
  const { result } = await rpc("tools/call", { name: "get_flooring_cost", arguments: { material: "laminate", sqft: 200 } });
  assert.ok(!result.isError);
  assert.match(result.content[0].text, /\$/);
});

test("unknown method returns JSON-RPC error", async () => {
  const r = await rpc("does/not/exist");
  assert.equal(r.error.code, -32601);
});
