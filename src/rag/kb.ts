import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkDoc } from "./chunk.ts";
import { CachedEmbedder, LocalE5Embedder } from "./embed.ts";
import { ClaudeReranker } from "./rerank.ts";
import { Retriever } from "./retriever.ts";
import type { Chunk, Doc } from "./types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_KB_DIR = path.join(process.env.MOKED_BUSINESS_DIR ?? path.join(ROOT, "business"), "kb");
const CACHE_DIR = path.join(ROOT, ".cache");

export interface KnowledgeBase {
  docs: Map<string, Doc>;
  chunks: Chunk[];
}

export async function loadKnowledgeBase(dir = process.env.MOKED_KB_DIR ?? DEFAULT_KB_DIR): Promise<KnowledgeBase> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  const docs = new Map<string, Doc>();
  for (const file of files) {
    const text = await readFile(path.join(dir, file), "utf8");
    const id = path.basename(file, ".md");
    docs.set(id, { id, title: text.match(/^# (.+)$/m)?.[1]?.trim() ?? id, text });
  }
  return { docs, chunks: [...docs.values()].flatMap(chunkDoc) };
}

export function hasAnthropicCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** Wire up the full pipeline; the re-ranker is included only when Claude credentials exist. */
export function createRetriever(kb: KnowledgeBase, { rerank = hasAnthropicCredentials() } = {}): Retriever {
  return new Retriever(kb.chunks, {
    embedder: new CachedEmbedder(new LocalE5Embedder(), CACHE_DIR),
    reranker: rerank ? new ClaudeReranker() : undefined,
  });
}

export function formatChunk(chunk: Chunk): string {
  return `<passage id="${chunk.id}" document="${chunk.docTitle}" section="${chunk.heading}">\n${chunk.text}\n</passage>`;
}
