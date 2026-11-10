/**
 * Retrieval ablation: the same questions through every retrieval mode.
 * Runs offline (local embeddings); the re-rank row is added when Claude
 * credentials are present. Fails the process if the hybrid pipeline regresses.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createRetriever, hasAnthropicCredentials, loadKnowledgeBase } from "../src/rag/kb.ts";
import type { RetrievalMode } from "../src/rag/types.ts";
import { EVALS_DIR, loadScenarios, markdownTable, mean, pct, recallAtK, reciprocalRank } from "./lib.ts";

const GATE = { mode: "hybrid" as RetrievalMode, recallAt5: 0.9 };

const kb = await loadKnowledgeBase();
const retriever = createRetriever(kb);
// Retrieval is graded on the first message of every scenario whose answer is in the knowledge base.
const cases = (await loadScenarios())
  .filter((s) => s.expect.expected_chunks?.length)
  .map((s) => ({ id: s.id, question: s.turns[0]!, expected_chunks: s.expect.expected_chunks! }));

const knownIds = new Set(kb.chunks.map((c) => c.id));
for (const c of cases) {
  for (const id of c.expected_chunks) if (!knownIds.has(id)) throw new Error(`${c.id}: expected chunk '${id}' does not exist`);
}

const modes: RetrievalMode[] = ["bm25-naive", "bm25", "dense", "hybrid"];
if (hasAnthropicCredentials()) modes.push("hybrid-rerank");

const rows: (string | number)[][] = [];
const misses: string[] = [];
let gateValue = 0;

for (const mode of modes) {
  const perCase = [];
  for (const c of cases) {
    const retrieved = (await retriever.search(c.question, { mode, k: 5 })).map((hit) => hit.chunk.id);
    perCase.push({
      r1: recallAtK(retrieved, c.expected_chunks, 1),
      r3: recallAtK(retrieved, c.expected_chunks, 3),
      r5: recallAtK(retrieved, c.expected_chunks, 5),
      rr: reciprocalRank(retrieved, c.expected_chunks),
    });
    if (perCase.at(-1)!.r5 < 1) misses.push(`- \`${mode}\` ${c.id} "${c.question}": wanted ${c.expected_chunks.join(", ")}; got ${retrieved.join(", ")}`);
  }
  const r5 = mean(perCase.map((p) => p.r5));
  if (mode === GATE.mode) gateValue = r5;
  rows.push([`\`${mode}\``, pct(mean(perCase.map((p) => p.r1))), pct(mean(perCase.map((p) => p.r3))), pct(r5), mean(perCase.map((p) => p.rr)).toFixed(3)]);
}

const report = [
  "# Retrieval eval",
  "",
  `${cases.length} questions with known source passages, over ${kb.chunks.length} passages from ${kb.docs.size} documents.`,
  "",
  markdownTable(["Mode", "Recall@1", "Recall@3", "Recall@5", "MRR"], rows),
  "",
  "## Misses at k=5",
  "",
  misses.length ? misses.join("\n") : "None.",
  "",
].join("\n");

await writeFile(path.join(EVALS_DIR, "results/retrieval.md"), report);
console.log(report);

if (gateValue < GATE.recallAt5) {
  console.error(`FAIL: ${GATE.mode} Recall@5 ${pct(gateValue)} is below the ${pct(GATE.recallAt5)} gate`);
  process.exit(1);
}
