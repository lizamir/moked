import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Black-box test: start the real server as a subprocess and talk to it over stdio, as an MCP host would.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = new Client({ name: "moked-test", version: "0.0.0" });

const textOf = (result: Awaited<ReturnType<typeof client.callTool>>) =>
  (result.content as { type: string; text?: string }[]).map((block) => block.text ?? "").join("");

before(async () => {
  // ANTHROPIC_API_KEY is deliberately not forwarded: the server must work without it.
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/interfaces/mcp-server.ts"], cwd: root, env, stderr: "ignore" }));
});
after(() => client.close());

test("lists the three tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["get_document", "list_documents", "search_knowledge_base"]);
});

test("search returns the passage that answers the question", async () => {
  const result = await client.callTool({ name: "search_knowledge_base", arguments: { query: "דמי ביטול תור", limit: 3 } });
  assert.match(textOf(result), /<passage id="cancellation#1"/);
  assert.match(textOf(result), /50 ₪/);
});

test("get_document returns a full document and reports unknown ids as errors", async () => {
  assert.match(textOf(await client.callTool({ name: "get_document", arguments: { document_id: "payments" } })), /ביט/);
  const missing = await client.callTool({ name: "get_document", arguments: { document_id: "nope" } });
  assert.equal(missing.isError, true);
  assert.match(textOf(missing), /Available: /);
});

test("re-ranking without credentials fails with an actionable message", async () => {
  const result = await client.callTool({ name: "search_knowledge_base", arguments: { query: "פנסיון", rerank: true } });
  assert.equal(result.isError, true);
  assert.match(textOf(result), /rerank=false/);
});
