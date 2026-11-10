/**
 * End-to-end agent eval: every scenario is a real conversation with Claude.
 *
 * Each one runs in its own sandbox (a temp folder for bookings, mail and the
 * request log) with a fixed clock, so "tomorrow at 10:00" means the same thing
 * on every run. Needs ANTHROPIC_API_KEY. Fails the process below the gate.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractCitations, type Step } from "../src/agent/conversation.ts";
import { startConversation } from "../src/agent/index.ts";
import { hasAnthropicCredentials } from "../src/rag/kb.ts";
import { createServices } from "../src/tools/index.ts";
import { checkScenario, EVALS_DIR, loadScenarios, markdownTable, pct, SCENARIO_TYPES, type Check, type Effects, type Scenario, type ScenarioRun } from "./lib.ts";

const GATE = 0.85;
/** A Sunday morning: the salon is open, and the whole coming week can be booked. */
const FIXED_NOW = { date: "2026-11-15", time: "10:00" };

if (!hasAnthropicCredentials()) {
  console.error("The agent eval calls the Claude API. Set ANTHROPIC_API_KEY (see .env.example).");
  process.exit(2);
}

async function countEffects(dir: string): Promise<Effects> {
  const appointments = await readFile(path.join(dir, "appointments.json"), "utf8").then((text) => (JSON.parse(text) as unknown[]).length, () => 0);
  const emails = await readdir(path.join(dir, "outbox")).then((files) => files.length, () => 0);
  const requests = await readFile(path.join(dir, "requests.csv"), "utf8").then((text) => text.trim().split("\n").length - 1, () => 0);
  return { appointments, emails, requests };
}

interface Result extends ScenarioRun {
  id: string;
  scenario: Scenario["scenario"];
  pass: boolean;
  checks: Check[];
}

async function runScenario(scenario: Scenario): Promise<Result> {
  const dir = await mkdtemp(path.join(tmpdir(), "moked-eval-"));
  try {
    const services = await createServices({ runtimeDir: dir, clock: () => FIXED_NOW });
    const conversation = await startConversation({ services, approve: async () => scenario.approve ?? true });
    const answers: string[] = [];
    const steps: Step[] = [];
    for (const message of scenario.turns) {
      const turn = await conversation.send(message);
      answers.push(turn.answer);
      steps.push(...turn.steps);
    }
    const joined = answers.join("\n\n");
    const run = { answers: joined, steps, citations: extractCitations(joined), effects: await countEffects(dir) };
    const checks = checkScenario(scenario, run);
    return { id: scenario.id, scenario: scenario.scenario, pass: checks.every((c) => c.pass), checks, ...run };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// MOKED_SCENARIOS=s20,s12 runs a subset (for iterating on one failure). Only a full run writes the report.
const only = process.env.MOKED_SCENARIOS?.split(",").map((id) => id.trim());
const scenarios = (await loadScenarios()).filter((s) => !only || only.includes(s.id));
const results: Result[] = [];
for (const scenario of scenarios) {
  const result = await runScenario(scenario).catch((error: unknown): Result => ({
    id: scenario.id,
    scenario: scenario.scenario,
    pass: false,
    checks: [{ name: "ran_without_error", pass: false, detail: error instanceof Error ? error.message : String(error) }],
    answers: "",
    steps: [],
    citations: [],
    effects: { appointments: 0, emails: 0, requests: 0 },
  }));
  results.push(result);
  console.error(`${result.pass ? "PASS" : "FAIL"} ${result.id} (${result.scenario})`);
}

const passRate = results.filter((r) => r.pass).length / results.length;
const byType = SCENARIO_TYPES.map((type) => {
  const group = results.filter((r) => r.scenario === type);
  return [type, `${group.filter((r) => r.pass).length}/${group.length}`];
});
const failures = results
  .filter((r) => !r.pass)
  .map((r) => `- ${r.id}: ${r.checks.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`).join("; ")}`);

const report = [
  "# Agent eval",
  "",
  `${results.filter((r) => r.pass).length} of ${results.length} scenarios passed (${pct(passRate)}).`,
  "",
  markdownTable(["Scenario type", "Passed"], byType),
  "",
  "## Failures",
  "",
  failures.length ? failures.join("\n") : "None.",
  "",
].join("\n");

if (!only) {
  await writeFile(path.join(EVALS_DIR, "results/agent.md"), report);
  await writeFile(path.join(EVALS_DIR, "results/agent.json"), JSON.stringify(results, null, 2));
}
console.log(report);

if (passRate < GATE) {
  console.error(`FAIL: pass rate ${pct(passRate)} is below the ${pct(GATE)} gate`);
  process.exit(1);
}
