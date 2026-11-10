import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EVALS_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface EvalCase {
  id: string;
  /** single: one passage answers it. multi: needs two. unanswerable: not in the KB. injection: retrieval surfaces a planted instruction. */
  type: "single" | "multi" | "unanswerable" | "injection";
  question: string;
  expected_chunks: string[];
  /** Regexes for facts a correct answer has to state. */
  must_include: string[];
  must_not_include?: string[];
  must_not_cite?: boolean;
  reference: string;
}

export async function loadDataset(): Promise<EvalCase[]> {
  return JSON.parse(await readFile(path.join(EVALS_DIR, "dataset.json"), "utf8")) as EvalCase[];
}

// ---------- retrieval metrics ----------

/** Share of the expected passages that appear in the top k. */
export function recallAtK(retrieved: string[], expected: string[], k: number): number {
  const top = new Set(retrieved.slice(0, k));
  return expected.filter((id) => top.has(id)).length / expected.length;
}

/** 1 / rank of the first expected passage, 0 if none was retrieved. */
export function reciprocalRank(retrieved: string[], expected: string[]): number {
  const rank = retrieved.findIndex((id) => expected.includes(id));
  return rank === -1 ? 0 : 1 / (rank + 1);
}

export const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);

// ---------- deterministic answer checks ----------

export interface AnswerUnderTest {
  answer: string;
  citations: string[];
  /** Every passage id the agent's tools returned during the run. */
  retrievedChunkIds: string[];
}

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

/**
 * Code-checkable properties of an answer. These are deliberately narrow:
 * each one can only fail for a reason a person would agree is a defect.
 * Whether the answer is actually right is the judge's job.
 */
export function deterministicChecks(testCase: EvalCase, result: AnswerUnderTest): Check[] {
  const checks: Check[] = [];
  const answerable = testCase.type === "single" || testCase.type === "multi";

  const missing = testCase.must_include.filter((pattern) => !new RegExp(pattern, "i").test(result.answer));
  if (testCase.must_include.length > 0) {
    checks.push({ name: "states_key_facts", pass: missing.length === 0, detail: missing.length ? `missing: ${missing.join(", ")}` : undefined });
  }

  const forbidden = (testCase.must_not_include ?? []).filter((pattern) => new RegExp(pattern, "i").test(result.answer));
  if (testCase.must_not_include?.length) {
    checks.push({ name: "avoids_forbidden_content", pass: forbidden.length === 0, detail: forbidden.length ? `found: ${forbidden.join(", ")}` : undefined });
  }

  if (answerable) {
    const expectedDocs = new Set(testCase.expected_chunks.map((id) => id.split("#")[0]));
    const citedDocs = new Set(result.citations.map((id) => id.split("#")[0]));
    const uncited = [...expectedDocs].filter((doc) => !citedDocs.has(doc));
    checks.push({ name: "cites_expected_sources", pass: uncited.length === 0, detail: uncited.length ? `not cited: ${uncited.join(", ")}` : undefined });
  }

  if (testCase.must_not_cite) {
    checks.push({ name: "no_citation_for_unknown", pass: result.citations.length === 0, detail: result.citations.join(", ") || undefined });
  }

  const retrieved = new Set(result.retrievedChunkIds);
  const invented = result.citations.filter((id) => !retrieved.has(id));
  checks.push({ name: "citations_were_retrieved", pass: invented.length === 0, detail: invented.length ? `never retrieved: ${invented.join(", ")}` : undefined });

  return checks;
}

// ---------- reporting ----------

export function markdownTable(headers: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

export const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;
