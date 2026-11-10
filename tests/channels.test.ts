import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import type { Approver, Turn } from "../src/agent/conversation.ts";
import { ChatSessions, parseApproval, type Outgoing, type StartConversation } from "../src/interfaces/sessions.ts";
import { createWebChat } from "../src/interfaces/web/server.ts";
import { toWhatsAppMessage, whatsAppSender } from "../src/interfaces/whatsapp/client.ts";
import { createWhatsAppWebhook, parseWebhook, validSignature } from "../src/interfaces/whatsapp/server.ts";

// A stand-in agent: any message containing "תור" asks for approval, everything else is echoed.
const fakeAgent: StartConversation = async (approve: Approver) => ({
  send: async (text: string): Promise<Turn> => {
    if (!text.includes("תור")) return { answer: `קיבלתי: ${text}`, steps: [], stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 } };
    const approved = await approve({ tool: "book_appointment", input: {}, summary: "לקבוע תור מחר ב-10:00" });
    return { answer: approved ? "התור נקבע" : "לא קבעתי", steps: [], stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 } };
  },
});

function recorder() {
  const sent: [string, Outgoing][] = [];
  let notify = () => {};
  const send = async (user: string, message: Outgoing) => {
    sent.push([user, message]);
    notify();
  };
  /** Resolves once `count` messages have been sent in total. */
  const waitFor = (count: number) => new Promise<void>((resolve) => (notify = () => sent.length >= count && resolve()));
  return { sent, send, waitFor };
}

test("approval replies are read generously but never guessed", () => {
  for (const yes of ["כן", "כן!", "כן בבקשה", "Yes", "approve_yes"]) assert.equal(parseApproval(yes), true, yes);
  for (const no of ["לא", "לא תודה", "no", "approve_no"]) assert.equal(parseApproval(no), false, no);
  for (const unclear of ["אולי", "מה?", ""]) assert.equal(parseApproval(unclear), null, unclear);
});

test("sessions: a request waits for the person's yes, then finishes", async () => {
  const { sent, send, waitFor } = recorder();
  const sessions = new ChatSessions(fakeAgent, send);
  const asked = waitFor(1);
  const handled = sessions.receive("dana", "תקבעו לי תור");
  await asked;
  assert.equal(sent[0]![1].kind, "approval");
  await sessions.receive("dana", "אולי"); // unclear: asked again, still waiting
  assert.equal(sent[1]![1].kind, "approval");
  await sessions.receive("dana", "כן");
  await handled;
  assert.deepEqual(sent[2], ["dana", { kind: "text", text: "התור נקבע", steps: [] }]);
});

test("sessions: a no is respected, and people do not share conversations", async () => {
  const { sent, send, waitFor } = recorder();
  const sessions = new ChatSessions(fakeAgent, send);
  const asked = waitFor(1);
  const handled = sessions.receive("dana", "תקבעו לי תור");
  await asked;
  await sessions.receive("yossi", "שלום"); // someone else, not an answer to Dana's question
  await sessions.receive("dana", "לא");
  await handled;
  assert.deepEqual(sent.map(([user, m]) => [user, m.text]), [
    ["dana", "לפני שאני ממשיך, צריך את האישור שלך:\nלקבוע תור מחר ב-10:00\nלאשר?"],
    ["yossi", "קיבלתי: שלום"],
    ["dana", "לא קבעתי"],
  ]);
});

const servers: { close(): void }[] = [];
after(() => servers.forEach((s) => s.close()));
async function listen(server: ReturnType<typeof createWebChat>) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("web chat: messages in, events out, approval through the same channel", async () => {
  const base = await listen(createWebChat(fakeAgent));
  const session = "test-session-1";
  const post = (text: string) => fetch(`${base}/api/message`, { method: "POST", body: JSON.stringify({ session, text }) });
  const events = async (after = 0) => (await (await fetch(`${base}/api/events?session=${session}&after=${after}`)).json()) as { events: Outgoing[]; next: number };
  const until = async (count: number) => {
    for (let i = 0; i < 50; i++) {
      const result = await events();
      if (result.events.length >= count) return result.events;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("timed out");
  };

  assert.equal((await post("תקבעו לי תור")).status, 202);
  assert.equal((await until(1))[0]!.kind, "approval");
  await post("כן");
  assert.equal((await until(2))[1]!.text, "התור נקבע");
  assert.equal((await fetch(`${base}/api/message`, { method: "POST", body: "{}" })).status, 400);
  assert.match(await (await fetch(base)).text(), /<html lang="he" dir="rtl">/);
});

test("whatsapp: approval questions become reply buttons", () => {
  const message = toWhatsAppMessage("972500000000", { kind: "approval", text: "לאשר?" }) as { type: string; interactive: { action: { buttons: { reply: { id: string; title: string } }[] } } };
  assert.equal(message.type, "interactive");
  assert.deepEqual(message.interactive.action.buttons.map((b) => b.reply.id), ["approve_yes", "approve_no"]);
  for (const b of message.interactive.action.buttons) assert.ok(b.reply.title.length <= 20, "WhatsApp caps button titles at 20 characters");
  assert.deepEqual(toWhatsAppMessage("972500000000", { kind: "status", text: "רגע" }), { messaging_product: "whatsapp", to: "972500000000", type: "text", text: { body: "רגע" } });
});

test("whatsapp: the sender calls the Cloud API with the token", async () => {
  const calls: [string, RequestInit][] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  await whatsAppSender({ token: "T", phoneNumberId: "123", apiVersion: "v23.0" }, fakeFetch)("972500000000", { kind: "status", text: "היי" });
  assert.equal(calls[0]![0], "https://graph.facebook.com/v23.0/123/messages");
  assert.equal((calls[0]![1].headers as Record<string, string>).authorization, "Bearer T");
});

const webhookBody = (messages: unknown[]) => JSON.stringify({ entry: [{ changes: [{ value: { messages } }] }] });
const sign = (body: string, secret = "s3cret") => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

test("whatsapp: webhook payloads, signatures and button taps are understood", () => {
  const body = JSON.parse(webhookBody([
    { from: "972501", id: "m1", type: "text", text: { body: "שלום" } },
    { from: "972501", id: "m2", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "approve_yes", title: "כן, לאשר" } } },
    { from: "972501", id: "m3", type: "image" },
  ]));
  assert.deepEqual(parseWebhook(body).map((m) => m.text), ["שלום", "approve_yes"]);
  assert.deepEqual(parseWebhook({}), []);
  assert.ok(validSignature("{}", sign("{}"), "s3cret"));
  assert.ok(!validSignature("{}", sign("{}", "other"), "s3cret"));
  assert.ok(!validSignature("{}", undefined, "s3cret"));
});

test("whatsapp: the webhook verifies Meta's handshake, rejects unsigned calls and handles each message once", async () => {
  const { sent, send, waitFor } = recorder();
  const base = await listen(createWhatsAppWebhook({ start: fakeAgent, send, verifyToken: "verify-me", appSecret: "s3cret" }));

  const handshake = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`);
  assert.deepEqual([handshake.status, await handshake.text()], [200, "42"]);
  assert.equal((await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`)).status, 403);

  const body = webhookBody([{ from: "972501", id: "m1", type: "text", text: { body: "שלום" } }]);
  assert.equal((await fetch(`${base}/webhook`, { method: "POST", body })).status, 401);

  const replied = waitFor(1);
  const post = () => fetch(`${base}/webhook`, { method: "POST", body, headers: { "x-hub-signature-256": sign(body) } });
  assert.equal((await post()).status, 200);
  await post(); // Meta redelivers: must not be answered twice
  await replied;
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(sent.map(([user, m]) => [user, m.text]), [["972501", "קיבלתי: שלום"]]);
});
