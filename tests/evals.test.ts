import assert from "node:assert/strict";
import { test } from "node:test";
import { deterministicChecks, loadDataset, recallAtK, reciprocalRank, type EvalCase } from "../evals/lib.ts";
import { extractCitations } from "../src/agent/agent.ts";
import { loadKnowledgeBase } from "../src/rag/kb.ts";

const dataset = await loadDataset();
const kb = await loadKnowledgeBase();

test("retrieval metrics", () => {
  assert.equal(recallAtK(["a", "b", "c"], ["b", "z"], 3), 0.5);
  assert.equal(recallAtK(["a", "b", "c"], ["c"], 2), 0);
  assert.equal(reciprocalRank(["a", "b"], ["b"]), 0.5);
  assert.equal(reciprocalRank(["a"], ["z"]), 0);
});

test("citations are parsed from the answer text", () => {
  assert.deepEqual(extractCitations("129 ₪ [pricing#1], ועוד [cancellation-refunds#2] [pricing#1]"), ["pricing#1", "cancellation-refunds#2"]);
});

test("dataset: 20 unique cases, every expected passage exists", () => {
  assert.equal(dataset.length, 20);
  assert.equal(new Set(dataset.map((c) => c.id)).size, 20);
  const ids = new Set(kb.chunks.map((c) => c.id));
  for (const c of dataset) for (const id of c.expected_chunks) assert.ok(ids.has(id), `${c.id}: ${id}`);
});

// The grader has to accept a known-good answer, or a failing score would say more about the grader than the agent.
test("dataset: each reference answer passes the deterministic grader", () => {
  for (const c of dataset) {
    const citations = c.expected_chunks;
    const failed = deterministicChecks(c, { answer: c.reference, citations, retrievedChunkIds: citations }).filter((check) => !check.pass);
    assert.deepEqual(failed, [], c.id);
  }
});

test("dataset: the key facts of an answerable case really are in its source passages", () => {
  for (const c of dataset.filter((c) => c.expected_chunks.length > 0)) {
    const source = kb.chunks.filter((chunk) => c.expected_chunks.includes(chunk.id)).map((chunk) => chunk.text).join("\n");
    for (const pattern of c.must_include) assert.match(source, new RegExp(pattern, "i"), `${c.id}: ${pattern}`);
  }
});

const sample: EvalCase = { id: "t", type: "single", question: "", expected_chunks: ["pricing#1"], must_include: ["129"], reference: "" };
const failedNames = (c: EvalCase, answer: string, citations: string[], retrieved = citations) =>
  deterministicChecks(c, { answer, citations, retrievedChunkIds: retrieved }).filter((check) => !check.pass).map((check) => check.name);

test("grader flags a wrong figure, a missing citation and an invented citation", () => {
  assert.deepEqual(failedNames(sample, "129 ₪", ["pricing#1"]), []);
  assert.deepEqual(failedNames(sample, "139 ₪", ["pricing#1"]), ["states_key_facts"]);
  assert.deepEqual(failedNames(sample, "129 ₪", []), ["cites_expected_sources"]);
  assert.deepEqual(failedNames(sample, "129 ₪", ["pricing#1", "pricing#9"], ["pricing#1"]), ["citations_were_retrieved"]);
});

test("grader flags an injected coupon code", () => {
  const injection = dataset.find((c) => c.type === "injection")!;
  assert.deepEqual(failedNames(injection, "כן! הקוד FREE100 נותן שנה חינם", []), ["avoids_forbidden_content"]);
});
