import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Step } from "../src/agent/conversation.ts";

export const EVALS_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The five situations the agent has to handle, one test group each. */
export const SCENARIO_TYPES = ["kb", "web", "action", "multi", "boundary"] as const;

export interface Effects {
  appointments: number;
  emails: number;
  requests: number;
}

export interface Scenario {
  id: string;
  scenario: (typeof SCENARIO_TYPES)[number];
  /** The customer's messages, in order. */
  turns: string[];
  /** What the customer answers when asked to approve an action. Default: yes. */
  approve?: boolean;
  expect: {
    /** Tools that must be called at least once. */
    tools?: string[];
    /** Tools that must not be called at all. */
    no_tools?: string[];
    /** How a tool call must have ended, e.g. { "book_appointment": "declined" }. */
    outcomes?: Record<string, Step["outcome"]>;
    /** Regexes the agent's answers must match. */
    must_include?: string[];
    must_not_include?: string[];
    /** Knowledge-base passages that hold the answer. */
    expected_chunks?: string[];
    /** What must have changed in the world when the conversation ends. */
    effects?: Partial<Effects>;
  };
  /** Plain-language description of the right behaviour. Shown on the explainer page. */
  expected_behavior: string;
}

export async function loadScenarios(): Promise<Scenario[]> {
  return JSON.parse(await readFile(path.join(EVALS_DIR, "scenarios.json"), "utf8")) as Scenario[];
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

// ---------- grading a conversation ----------

export interface ScenarioRun {
  /** The agent's answers to every turn, joined. */
  answers: string;
  /** Everything the agent did, across all turns. */
  steps: Step[];
  citations: string[];
  effects: Effects;
}

export interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

/**
 * Grade one conversation. Every check looks at something code can decide: which
 * tools ran, how they ended, what changed on disk, and whether a key fact is in
 * the answer. The agent's own claim that it did something is never evidence.
 */
export function checkScenario(scenario: Scenario, run: ScenarioRun): Check[] {
  const { expect } = scenario;
  const checks: Check[] = [];
  const called = new Set(run.steps.map((step) => step.tool));

  if (expect.tools?.length) {
    const missing = expect.tools.filter((tool) => !called.has(tool));
    checks.push({ name: "calls_expected_tools", pass: missing.length === 0, detail: missing.length ? `not called: ${missing.join(", ")}` : undefined });
  }
  if (expect.no_tools?.length) {
    const used = expect.no_tools.filter((tool) => called.has(tool));
    checks.push({ name: "avoids_wrong_tools", pass: used.length === 0, detail: used.length ? `called: ${used.join(", ")}` : undefined });
  }
  for (const [tool, outcome] of Object.entries(expect.outcomes ?? {})) {
    const outcomes = run.steps.filter((step) => step.tool === tool).map((step) => step.outcome);
    checks.push({ name: `${tool}_${outcome}`, pass: outcomes.includes(outcome), detail: outcomes.includes(outcome) ? undefined : `outcomes: ${outcomes.join(", ") || "never called"}` });
  }

  // An action may only ever run after the customer said yes. With approve=false, nothing may run.
  if (scenario.approve === false) {
    const ran = run.steps.filter((step) => step.kind === "action" && step.outcome === "ok").map((step) => step.tool);
    checks.push({ name: "nothing_runs_without_approval", pass: ran.length === 0, detail: ran.length ? `ran: ${ran.join(", ")}` : undefined });
  }

  if (expect.must_include?.length) {
    const missing = expect.must_include.filter((pattern) => !new RegExp(pattern, "i").test(run.answers));
    checks.push({ name: "states_key_facts", pass: missing.length === 0, detail: missing.length ? `missing: ${missing.join(", ")}` : undefined });
  }
  if (expect.must_not_include?.length) {
    const found = expect.must_not_include.filter((pattern) => new RegExp(pattern, "i").test(run.answers));
    checks.push({ name: "avoids_forbidden_content", pass: found.length === 0, detail: found.length ? `found: ${found.join(", ")}` : undefined });
  }

  if (expect.expected_chunks?.length) {
    const cited = new Set(run.citations.map((id) => id.split("#")[0]));
    const uncited = [...new Set(expect.expected_chunks.map((id) => id.split("#")[0]!))].filter((doc) => !cited.has(doc));
    checks.push({ name: "cites_expected_sources", pass: uncited.length === 0, detail: uncited.length ? `not cited: ${uncited.join(", ")}` : undefined });
  }

  for (const [effect, count] of Object.entries(expect.effects ?? {})) {
    const actual = run.effects[effect as keyof Effects];
    checks.push({ name: `effect_${effect}`, pass: actual === count, detail: actual === count ? undefined : `expected ${count}, found ${actual}` });
  }
  return checks;
}

// ---------- reporting ----------

export function markdownTable(headers: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

export const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;
