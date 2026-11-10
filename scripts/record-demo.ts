/**
 * Records one real conversation with the agent for the demo page and video.
 *
 * Runs the customer script below through the same session layer as the web
 * chat and WhatsApp, in a sandbox folder with a fixed clock, answering "כן"
 * to every approval. Saves what was said, which tools ran, and the booking,
 * email and calendar invite that resulted. Calls the Claude API once per turn;
 * the demo then replays the recording for free.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startConversation } from "../src/agent/index.ts";
import { ChatSessions, type Outgoing } from "../src/interfaces/sessions.ts";
import { ROOT } from "../src/services/business.ts";
import { createServices } from "../src/tools/index.ts";

const CUSTOMER = [
  "היי! כמה עולה מקלחת וייבוש לכלב?",
  "מעולה. אפשר לקבוע ליום שלישי ב-11:00? אני דנה, והכלב שלי לוקי",
  "תשלחו לי אישור עם זימון ליומן למייל dana@example.com",
];
const NOW = { date: "2026-11-15", time: "10:00" }; // Sunday morning

const dir = await mkdtemp(path.join(tmpdir(), "moked-demo-"));
const services = await createServices({ runtimeDir: dir, clock: () => NOW });
const transcript: ({ from: "customer"; text: string } | ({ from: "agent" } & Outgoing))[] = [];

let onEvent: (message: Outgoing) => void = () => {};
const sessions = new ChatSessions((approve) => startConversation({ approve, services }), async (_user, message) => {
  transcript.push({ from: "agent", ...message });
  onEvent(message);
});

/** Send one customer message and answer approvals with "כן" until the agent gives its final reply. */
async function say(text: string) {
  transcript.push({ from: "customer", text });
  console.error(`> ${text}`);
  await new Promise<void>((resolve) => {
    onEvent = (message) => {
      console.error(`< [${message.kind}] ${message.text.slice(0, 120)}`);
      if (message.kind === "approval") {
        transcript.push({ from: "customer", text: "כן" });
        void sessions.receive("demo", "כן");
      } else resolve();
    };
    void sessions.receive("demo", text);
  });
}

try {
  for (const text of CUSTOMER) await say(text);
  const outbox = path.join(dir, "outbox");
  const emails = await readdir(outbox).then((files) => Promise.all(files.map((f) => readFile(path.join(outbox, f), "utf8"))), () => []);
  const appointments = JSON.parse(await readFile(path.join(dir, "appointments.json"), "utf8").catch(() => "[]")) as unknown[];
  const out = { recordedAt: new Date().toISOString(), clock: NOW, business: services.profile.name, transcript, appointments, emails };
  await writeFile(path.join(ROOT, "site/demo-conversation.json"), JSON.stringify(out, null, 2));
  console.error(`\nSaved site/demo-conversation.json: ${transcript.length} messages, ${appointments.length} appointments, ${emails.length} emails`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
