import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { Conversation, extractCitations, withoutCitations, type ModelClient } from "../src/agent/conversation.ts";
import { buildSystemPrompt } from "../src/agent/prompt.ts";
import { loadProfile } from "../src/services/business.ts";
import { defineTool } from "../src/tools/types.ts";

// The agent loop is tested without Claude: a scripted "model" replays fixed replies, so the
// tests check what the loop does with them (run, ask approval, refuse), not what a model says.

type Reply = Pick<Anthropic.Message, "content" | "stop_reason">;
const text = (value: string): Reply => ({ content: [{ type: "text", text: value, citations: null }], stop_reason: "end_turn" });
const callTool = (name: string, input: unknown, id = "call_1"): Reply => ({
  content: [{ type: "tool_use", id, name, input, caller: { type: "direct" } }],
  stop_reason: "tool_use",
});

function scripted(replies: Reply[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const model: ModelClient = {
    create: async (params) => {
      requests.push(structuredClone(params));
      const reply = replies.shift();
      if (!reply) throw new Error("script ran out of replies");
      return { id: "msg", type: "message", role: "assistant", model: "fake", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 }, ...reply } as Anthropic.Message;
    },
  };
  return { model, requests };
}

function setup(replies: Reply[], approve = true) {
  const ran: unknown[] = [];
  const asked: string[] = [];
  const tools = [
    defineTool({ name: "lookup", kind: "read", description: "", schema: z.object({ q: z.string() }), run: async ({ q }) => `found ${q}` }),
    defineTool({
      name: "book",
      kind: "action",
      description: "",
      schema: z.object({ time: z.string().regex(/^\d{2}:\d{2}$/) }),
      summarize: (i) => `לקבוע תור ב-${i.time}`,
      run: async (i) => {
        ran.push(i);
        if (i.time === "23:00") throw new Error("סגור בשעה הזו");
        return "booked";
      },
    }),
  ];
  const { model, requests } = scripted(replies);
  const conversation = new Conversation({
    model,
    tools,
    system: "test",
    maxSteps: 4,
    approve: async (request) => {
      asked.push(request.summary);
      return approve;
    },
  });
  return { conversation, requests, ran, asked };
}

/** The tool_result the loop sent back to the model after the first tool call. */
const firstToolResult = (requests: Anthropic.MessageCreateParamsNonStreaming[]) =>
  (requests[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;

test("a read tool runs without asking anyone", async () => {
  const { conversation, asked, requests } = setup([callTool("lookup", { q: "מחיר" }), text("190 ₪")]);
  const turn = await conversation.send("כמה עולה?");
  assert.equal(turn.answer, "190 ₪");
  assert.deepEqual(turn.steps.map((s) => [s.tool, s.outcome, s.result]), [["lookup", "ok", "found מחיר"]]);
  assert.deepEqual(asked, []);
  assert.equal(firstToolResult(requests).content, "found מחיר");
});

test("an action runs only after the customer approves, and they see what will happen", async () => {
  const { conversation, ran, asked } = setup([callTool("book", { time: "10:00" }), text("נקבע")]);
  const turn = await conversation.send("תקבעו לי ב-10");
  assert.deepEqual(asked, ["לקבוע תור ב-10:00"]);
  assert.deepEqual(ran, [{ time: "10:00" }]);
  assert.equal(turn.steps[0]!.outcome, "ok");
});

test("a declined action never runs, and the model is told so", async () => {
  const { conversation, ran, requests } = setup([callTool("book", { time: "10:00" }), text("בסדר, לא קבעתי")], false);
  const turn = await conversation.send("תקבעו לי ב-10");
  assert.deepEqual(ran, []);
  assert.equal(turn.steps[0]!.outcome, "declined");
  assert.match(String(firstToolResult(requests).content), /declined/);
});

test("input that fails the schema is rejected before approval or execution", async () => {
  const { conversation, ran, asked, requests } = setup([callTool("book", { time: "בבוקר" }), text("באיזו שעה?")]);
  const turn = await conversation.send("תקבעו לי בבוקר");
  assert.deepEqual([ran, asked], [[], []]);
  assert.equal(turn.steps[0]!.outcome, "invalid");
  assert.equal(firstToolResult(requests).is_error, true);
});

test("a tool's refusal goes back to the model as an error it can recover from", async () => {
  const { conversation, requests } = setup([callTool("book", { time: "23:00" }), text("המספרה סגורה בשעה הזו")]);
  const turn = await conversation.send("תקבעו לי ב-23:00");
  assert.equal(turn.steps[0]!.outcome, "error");
  assert.deepEqual([firstToolResult(requests).content, firstToolResult(requests).is_error], ["סגור בשעה הזו", true]);
});

test("a tool the agent does not have is reported, not executed", async () => {
  const { conversation } = setup([callTool("delete_everything", {}), text("אין לי כלי כזה")]);
  assert.equal((await conversation.send("מחק הכול")).steps[0]!.outcome, "error");
});

test("the loop stops at maxSteps even if the model keeps calling tools", async () => {
  const { conversation, requests } = setup(Array.from({ length: 10 }, (_, i) => callTool("lookup", { q: "x" }, `call_${i}`)));
  const turn = await conversation.send("לולאה");
  assert.equal(requests.length, 4);
  assert.equal(turn.steps.length, 4);
});

test("a paused web search is continued, and counted as a web step", async () => {
  const paused: Reply = { content: [{ type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "פודל" }, caller: { type: "direct" } }], stop_reason: "pause_turn" };
  const { conversation, requests } = setup([paused, text("לפי האינטרנט: כל 6 שבועות")]);
  const turn = await conversation.send("כל כמה זמן לספר פודל?");
  assert.equal(requests.length, 2);
  assert.deepEqual(turn.steps.map((s) => [s.tool, s.kind]), [["web_search", "web"]]);
  assert.equal(requests[1]!.messages.at(-1)!.role, "assistant");
});

test("the conversation remembers earlier turns", async () => {
  const { conversation, requests } = setup([text("90 ₪"), text("קבעתי")]);
  await conversation.send("כמה עולה מפגש היכרות?");
  await conversation.send("תקבעו לי אחד");
  assert.deepEqual(requests[1]!.messages.map((m) => m.role), ["user", "assistant", "user"]);
});

test("citations are parsed from the answer text", () => {
  assert.deepEqual(extractCitations("190 ₪ [services-prices#2], ועוד [cancellation#1] [services-prices#2]"), ["services-prices#2", "cancellation#1"]);
});

test("the system prompt is built from the business profile and today's date", async () => {
  const profile = await loadProfile();
  const prompt = buildSystemPrompt(profile, { date: "2026-11-15", time: "10:00" });
  assert.match(prompt, /Today is Sunday, 2026-11-15/);
  for (const service of profile.services) assert.ok(prompt.includes(service.id), service.id);
});

test("every tool call reaches the audit hook, including a declined action", async () => {
  const { model } = scripted([callTool("lookup", { q: "מחיר" }), callTool("book", { time: "10:00" }, "call_2"), text("בסדר, לא קבעתי.")]);
  const seen: string[] = [];
  const conversation = new Conversation({
    model,
    system: "",
    approve: async () => false,
    onStep: (step) => void seen.push(`${step.tool}:${step.kind}:${step.outcome}`),
    tools: [
      defineTool({ name: "lookup", kind: "read", description: "", schema: z.object({ q: z.string() }), run: async () => "found" }),
      defineTool({ name: "book", kind: "action", description: "", schema: z.object({ time: z.string() }), run: async () => "booked" }),
    ],
  });
  await conversation.send("תקבעו לי תור");
  assert.deepEqual(seen, ["lookup:read:ok", "book:action:declined"]);
});

test("customers never see passage ids", () => {
  assert.equal(withoutCitations("לילה עולה 140 ₪ לכלב [boarding#1]. צריך מקדמה של 30% [payments#3]."), "לילה עולה 140 ₪ לכלב. צריך מקדמה של 30%.");
  assert.equal(withoutCitations("סגורים בשבת [hours-location#2]\nנתראה!"), "סגורים בשבת\nנתראה!");
  assert.equal(withoutCitations("אין כאן מקורות."), "אין כאן מקורות.");
});
