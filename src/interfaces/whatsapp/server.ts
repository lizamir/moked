/**
 * WhatsApp webhook: Meta calls this server for every customer message.
 *   npm run whatsapp
 *
 * Needs a public HTTPS address (Meta cannot reach localhost), a WhatsApp
 * Business app in Meta's developer console, and the WHATSAPP_* values in
 * .env. See docs/whatsapp.md for the setup steps.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { ChatSessions, type Send, type StartConversation } from "../sessions.ts";

export interface IncomingText {
  from: string;
  id: string;
  text: string;
}

interface WebhookBody {
  entry?: { changes?: { value?: { messages?: WebhookMessage[] } }[] }[];
}
interface WebhookMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  interactive?: { type: string; button_reply?: { id: string; title: string } };
}

/** Pull the customer messages out of a webhook call. Status updates (sent, read) carry no messages and are skipped. */
export function parseWebhook(body: WebhookBody): IncomingText[] {
  const out: IncomingText[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        if (m.type === "text" && m.text?.body) out.push({ from: m.from, id: m.id, text: m.text.body });
        // A tap on an approval button arrives with the button id, which parseApproval understands.
        if (m.type === "interactive" && m.interactive?.button_reply) out.push({ from: m.from, id: m.id, text: m.interactive.button_reply.id });
      }
    }
  }
  return out;
}

/** Meta signs every webhook call with the app secret. Anything unsigned or mis-signed is not from Meta. */
export function validSignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

async function readRaw(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 200_000) throw new Error("body too large");
  }
  return body;
}

export function createWhatsAppWebhook({ start, send, verifyToken, appSecret }: { start: StartConversation; send: Send; verifyToken: string; appSecret: string }): Server {
  const sessions = new ChatSessions(start, send);
  const seen = new Set<string>(); // Meta retries deliveries; a message must be handled once.

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/webhook") return void res.writeHead(404).end();

    // One-time handshake when the webhook is registered in Meta's console.
    if (req.method === "GET") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === verifyToken;
      return void (ok ? res.writeHead(200).end(url.searchParams.get("hub.challenge") ?? "") : res.writeHead(403).end());
    }

    if (req.method !== "POST") return void res.writeHead(405).end();
    try {
      const raw = await readRaw(req);
      if (!validSignature(raw, req.headers["x-hub-signature-256"] as string | undefined, appSecret)) return void res.writeHead(401).end();
      // Acknowledge first: Meta expects a fast 200, and an approval can keep a message open for minutes.
      res.writeHead(200).end();
      for (const message of parseWebhook(JSON.parse(raw) as WebhookBody)) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        void sessions.receive(message.from, message.text);
      }
    } catch {
      if (!res.headersSent) res.writeHead(400).end();
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = (name: string) => {
    const value = process.env[name];
    if (!value) {
      console.error(`Missing ${name} in .env. See docs/whatsapp.md.`);
      process.exit(2);
    }
    return value;
  };
  const config = { token: env("WHATSAPP_TOKEN"), phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"), apiVersion: process.env.WHATSAPP_API_VERSION ?? "v23.0" };
  const verifyToken = env("WHATSAPP_VERIFY_TOKEN");
  const appSecret = env("WHATSAPP_APP_SECRET");
  env("ANTHROPIC_API_KEY");

  const { whatsAppSender } = await import("./client.ts");
  const { startConversation } = await import("../../agent/index.ts");
  const { createServices } = await import("../../tools/index.ts");
  const services = await createServices();
  const port = Number(process.env.PORT ?? 3200);
  createWhatsAppWebhook({ start: (approve) => startConversation({ approve, services }), send: whatsAppSender(config), verifyToken, appSecret }).listen(port, () => {
    console.log(`WhatsApp webhook listening on :${port}/webhook`);
  });
}
