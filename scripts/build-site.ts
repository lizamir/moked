/**
 * Builds docs/index.html, the project's explainer page (served by GitHub Pages).
 *
 * The page is one self-contained file: the knowledge base, the 20 eval
 * questions with their real retrieval results, and a browser bundle of the
 * same tokenizer and BM25 code the agent uses, so keyword search runs live in
 * the page. Embeddings need a model, so semantic results are precomputed here.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { loadDataset } from "../evals/lib.ts";
import { createRetriever, loadKnowledgeBase } from "../src/rag/kb.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const kb = await loadKnowledgeBase();
const retriever = createRetriever(kb, { rerank: false });
const ids = async (question: string, mode: "bm25" | "dense" | "hybrid") =>
  (await retriever.search(question, { mode, k: 5 })).map((hit) => hit.chunk.id);

const presets = [];
for (const c of await loadDataset()) {
  presets.push({
    id: c.id,
    type: c.type,
    question: c.question,
    reference: c.reference,
    expected: c.expected_chunks,
    dense: await ids(c.question, "dense"),
    hybrid: await ids(c.question, "hybrid"),
  });
}

/** The ablation table, read back from the report the eval wrote, so the page can never drift from it. */
const report = await readFile(path.join(ROOT, "evals/results/retrieval.md"), "utf8");
const results = [...report.matchAll(/^\| `([a-z0-9-]+)` \| (\d+)% \| (\d+)% \| (\d+)% \| ([\d.]+) \|$/gm)].map((m) => ({
  mode: m[1],
  r1: Number(m[2]),
  r3: Number(m[3]),
  r5: Number(m[4]),
  mrr: Number(m[5]),
}));
if (results.length < 4) throw new Error("Run `npm run eval:retrieval` first: no results table found");

const data = {
  chunks: kb.chunks,
  docCount: kb.docs.size,
  presets,
  results,
};

const bundle = await build({
  entryPoints: [path.join(ROOT, "site/demo.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false,
});

// "</" inside inline JSON or JS would close the script tag early.
const safe = (text: string) => text.replace(/<\//g, "<\\/");
const template = await readFile(path.join(ROOT, "site/template.html"), "utf8");
const html = template
  .replace("__DATA__", () => safe(JSON.stringify(data)))
  .replace("/*__SCRIPT__*/", () => safe(bundle.outputFiles[0]!.text));

await writeFile(path.join(ROOT, "docs/index.html"), html);
console.log(`docs/index.html: ${(html.length / 1024).toFixed(0)} KB, ${presets.length} questions, ${kb.chunks.length} passages`);
