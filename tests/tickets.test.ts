import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AuditLog } from "../src/services/audit.ts";
import { RequestLog } from "../src/services/request-log.ts";
import { JiraTickets, jiraFromEnv, type TicketSystem } from "../src/services/tickets.ts";
import { logTools } from "../src/tools/log.ts";

const clock = () => ({ date: "2026-11-15", time: "10:00" });
const sandbox = () => mkdtemp(path.join(tmpdir(), "moked-test-"));
const request = { customerName: "דנה לוי", contact: "050-1234567", topic: "הזמנה לפנסיון", details: "שבוע בדצמבר, כלב גדול" };
const toolInput = { customer_name: request.customerName, contact: request.contact, topic: request.topic, details: request.details };
const jira = { baseUrl: "https://parva.atlassian.net", email: "bot@parva.example", apiToken: "s3cret-token", projectKey: "PARVA" };

/** A stand-in for Jira that records what it was sent. */
function fakeJira(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("a staff request becomes a Jira issue in the configured project", async () => {
  const { calls, fetchImpl } = fakeJira(201, { key: "PARVA-12" });
  const ticket = await new JiraTickets(jira, fetchImpl).open(request);

  assert.deepEqual(ticket, { key: "PARVA-12", url: "https://parva.atlassian.net/browse/PARVA-12" });
  assert.equal(calls[0]!.url, "https://parva.atlassian.net/rest/api/3/issue");
  assert.equal(calls[0]!.init.method, "POST");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Basic ${Buffer.from("bot@parva.example:s3cret-token").toString("base64")}`);
  const { fields } = JSON.parse(String(calls[0]!.init.body));
  assert.deepEqual(fields.project, { key: "PARVA" });
  assert.equal(fields.summary, "הזמנה לפנסיון: דנה לוי");
  assert.equal(fields.description.type, "doc");
  assert.match(JSON.stringify(fields.description), /050-1234567/);
});

test("a Jira failure names the status and never the token", async () => {
  const { fetchImpl } = fakeJira(401, { errorMessages: ["bad credentials for s3cret-token"] });
  await assert.rejects(new JiraTickets(jira, fetchImpl).open(request), (error: Error) => {
    assert.match(error.message, /401/);
    assert.doesNotMatch(error.message, /s3cret-token/);
    return true;
  });
});

test("Jira is off when unset, on when complete, and refuses a half-filled setup", () => {
  assert.equal(jiraFromEnv({}), undefined);
  const full = { JIRA_BASE_URL: "https://parva.atlassian.net/", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "t", JIRA_PROJECT_KEY: "PARVA" };
  assert.ok(jiraFromEnv(full) instanceof JiraTickets);
  assert.throws(() => jiraFromEnv({ JIRA_BASE_URL: "https://parva.atlassian.net" }), /JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY/);
  assert.throws(() => jiraFromEnv({ ...full, JIRA_BASE_URL: "http://parva.atlassian.net" }), /https/);
});

test("log_request tells the agent the ticket number", async () => {
  const file = path.join(await sandbox(), "requests.csv");
  const tickets: TicketSystem = { open: async () => ({ key: "PARVA-12", url: "u" }) };
  const [tool] = logTools(new RequestLog(file, clock), tickets);
  assert.equal(tool!.kind, "action"); // still behind the approval gate
  assert.match(await tool!.run(toolInput), /ticket PARVA-12/);
  assert.match(await readFile(file, "utf8"), /דנה לוי/);
});

test("when Jira is down the request is still saved for the staff", async () => {
  const file = path.join(await sandbox(), "requests.csv");
  const tickets: TicketSystem = { open: async () => { throw new Error("Jira refused the ticket (HTTP 503)"); } };
  const [tool] = logTools(new RequestLog(file, clock), tickets);
  const result = await tool!.run(toolInput);
  assert.match(result, /no ticket number/);
  assert.match(await readFile(file, "utf8"), /הזמנה לפנסיון/);
});

test("without Jira the tool behaves as before", async () => {
  const [tool] = logTools(new RequestLog(path.join(await sandbox(), "requests.csv"), clock));
  assert.equal(await tool!.run(toolInput), "Recorded. A staff member returns requests within one business day.");
});

test("the audit log keeps one line per tool call and no customer details", async () => {
  const file = path.join(await sandbox(), "audit.jsonl");
  const audit = new AuditLog(file);
  await audit.record({ tool: "search_knowledge_base", kind: "read", outcome: "ok" });
  await audit.record({ tool: "log_request", kind: "action", outcome: "declined", input: toolInput } as never);
  const lines = (await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.deepEqual(Object.keys(lines[1]), ["time", "tool", "kind", "outcome"]);
  assert.deepEqual([lines[1].tool, lines[1].outcome], ["log_request", "declined"]);
  assert.doesNotMatch(JSON.stringify(lines), /דנה|050/);
});
