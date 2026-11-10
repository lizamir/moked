import assert from "node:assert/strict";
import { test } from "node:test";
import { Bm25Index } from "../src/rag/bm25.ts";
import { chunkDoc } from "../src/rag/chunk.ts";
import { reciprocalRankFusion } from "../src/rag/fuse.ts";
import { Retriever } from "../src/rag/retriever.ts";
import { hebrewVariants, normalize, tokenizeHebrew, tokenizeNaive } from "../src/rag/tokenize.ts";
import type { Chunk, Embedder, Reranker } from "../src/rag/types.ts";

test("normalize strips niqqud and folds final letters", () => {
  assert.equal(normalize("שָׁלוֹם"), "שלומ");
  assert.equal(normalize('מע"מ'), "מעמ");
});

test("prefixed and plural forms share a stem with the bare word", () => {
  const shared = (a: string, b: string) => hebrewVariants(normalize(a)).some((v) => hebrewVariants(normalize(b)).includes(v));
  assert.ok(shared("ובמסלול", "מסלול"));
  assert.ok(shared("התורים", "תור"));
  assert.ok(shared("הזמנת", "הזמנה"));
  assert.ok(!shared("מסלול", "תשלום"));
});

test("short words are not stripped down to nothing", () => {
  assert.deepEqual(hebrewVariants("שרת"), ["שרת"]);
});

test("compound tokens are searchable whole and by part", () => {
  const tokens = tokenizeHebrew("שגיאה E-4012 באירוע appointment.created");
  assert.ok(tokens.includes("e4012"));
  assert.ok(tokens.includes("4012"));
  assert.ok(tokens.includes("appointmentcreated"));
  assert.ok(tokens.includes("created"));
});

test("a Latin word glued to a Hebrew prefix is found", () => {
  assert.ok(tokenizeHebrew("תזכורות ב-WhatsApp").includes("whatsapp"));
});

test("naive tokenizer misses the prefixed form that the Hebrew tokenizer finds", () => {
  const docs = ["החיוב במסלול העסקי", "שעות הפעילות של הצ'אט"];
  const naive = new Bm25Index(docs.map(tokenizeNaive));
  const hebrew = new Bm25Index(docs.map(tokenizeHebrew));
  assert.equal(naive.search([["מסלול"]], 5).length, 0);
  assert.equal(hebrew.search([["מסלול"]], 5)[0]?.index, 0);
});

test("BM25 ranks the document with the rarer matching term first", () => {
  const index = new Bm25Index([["תור", "יומן"], ["תור", "תשלום"], ["תור", "צוות"]]);
  assert.equal(index.search([["תור"], ["תשלום"]], 3)[0]?.index, 1);
});

test("BM25 counts a word once, however many variants it has", () => {
  const index = new Bm25Index([["a", "a1", "a2"], ["a", "b"]]);
  const [first] = index.search([["a", "a1", "a2"], ["b"]], 2);
  assert.equal(first?.index, 1);
});

test("RRF prefers items ranked well by both lists", () => {
  const fused = reciprocalRankFusion([["a", "b", "c"], ["b", "c", "d"]]);
  assert.equal(fused[0]?.item, "b");
  assert.deepEqual(new Set(fused.map((f) => f.item)), new Set(["a", "b", "c", "d"]));
});

test("chunker splits on headings and numbers chunks per document", () => {
  const chunks = chunkDoc({ id: "doc", title: "כותרת", text: "# כותרת\n\nפתיח\n\n## ראשון\nתוכן א\n\n## שני\nתוכן ב\n" });
  assert.deepEqual(chunks.map((c) => [c.id, c.heading, c.text]), [
    ["doc#1", "כותרת", "פתיח"],
    ["doc#2", "ראשון", "תוכן א"],
    ["doc#3", "שני", "תוכן ב"],
  ]);
});

const chunk = (id: string, text: string): Chunk => ({ id, docId: id.split("#")[0]!, docTitle: "", heading: "", text });

test("retriever: the re-ranker has the last word on order", async () => {
  const chunks = [chunk("a#1", "תור ראשון"), chunk("b#1", "תור שני"), chunk("c#1", "משהו אחר")];
  // One-hot vectors: the query is closest to c, lexical search prefers a and b.
  const embedder: Embedder = {
    name: "fake",
    embed: async (texts, kind) => texts.map((_, i) => (kind === "query" ? [0, 0, 1] : [0, 1, 2].map((d) => (d === i ? 1 : 0)))),
  };
  const reranker: Reranker = { name: "fake", rerank: async (_query, candidates) => [...candidates].sort((x, y) => y.id.localeCompare(x.id)) };
  const retriever = new Retriever(chunks, { embedder, reranker });

  assert.equal(retriever.defaultMode, "hybrid-rerank");
  assert.deepEqual((await retriever.search("תור", { mode: "bm25" })).map((h) => h.chunk.id), ["a#1", "b#1"]);
  assert.equal((await retriever.search("תור", { mode: "dense" }))[0]?.chunk.id, "c#1");
  assert.deepEqual((await retriever.search("תור")).map((h) => h.chunk.id), ["c#1", "b#1", "a#1"]);
});

test("retriever without an embedder falls back to BM25", () => {
  assert.equal(new Retriever([chunk("a#1", "x")]).defaultMode, "bm25");
});
