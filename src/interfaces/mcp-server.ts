#!/usr/bin/env node
/**
 * MCP server exposing the knowledge base to any MCP client (Claude Desktop,
 * Claude Code, ...). The client's own model does the reasoning; this server
 * only retrieves, so it needs no API key unless re-ranking is requested.
 *
 * stdout carries the protocol. Anything meant for a human goes to stderr.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRetriever, formatChunk, hasAnthropicCredentials, loadKnowledgeBase } from "../rag/kb.ts";

const kb = await loadKnowledgeBase();
const retriever = createRetriever(kb);
const server = new McpServer({ name: "moked", version: "0.1.0" });

const text = (value: string, isError = false) => ({ content: [{ type: "text" as const, text: value }], isError });

server.registerTool(
  "search_knowledge_base",
  {
    title: "Search knowledge base",
    description:
      "Hybrid (BM25 + embeddings) search over the knowledge base of Parva (פרווה), a dog grooming salon and boarding kennel: services, prices, hours, booking and cancellation policy, vaccines, payments. Written in Hebrew. Returns the most relevant passages, best first, each with an id that can be cited or expanded with get_document.",
    inputSchema: {
      query: z.string().describe("Short natural-language query, ideally in Hebrew, about one topic"),
      limit: z.number().int().min(1).max(10).default(5).describe("How many passages to return"),
      rerank: z
        .boolean()
        .default(false)
        .describe("Re-rank candidates with Claude for higher precision. Slower; needs ANTHROPIC_API_KEY on the server."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, limit, rerank }) => {
    if (rerank && !hasAnthropicCredentials()) {
      return text("Re-ranking is unavailable: the server has no ANTHROPIC_API_KEY. Retry with rerank=false.", true);
    }
    const hits = await retriever.search(query, { k: limit, mode: rerank ? "hybrid-rerank" : "hybrid" });
    return text(hits.length ? hits.map((h) => formatChunk(h.chunk)).join("\n\n") : "No passages matched.");
  },
);

server.registerTool(
  "get_document",
  {
    title: "Get document",
    description: "Return one knowledge-base document in full. The id is the part of a passage id before '#', or any id from list_documents.",
    inputSchema: { document_id: z.string().describe("e.g. 'cancellation'") },
    annotations: { readOnlyHint: true },
  },
  async ({ document_id }) => {
    const doc = kb.docs.get(document_id);
    return doc ? text(doc.text) : text(`No document '${document_id}'. Available: ${[...kb.docs.keys()].join(", ")}`, true);
  },
);

server.registerTool(
  "list_documents",
  {
    title: "List documents",
    description: "List every document in the knowledge base with its id and title.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => text([...kb.docs.values()].map((d) => `${d.id}: ${d.title}`).join("\n")),
);

await server.connect(new StdioServerTransport());
console.error(`moked MCP server ready: ${kb.docs.size} documents, ${kb.chunks.length} passages`);
