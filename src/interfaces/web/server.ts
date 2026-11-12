/**
 * A browser chat with the real agent, on this computer.
 *   npm run web   then open http://localhost:3100
 *
 * Messages go in with POST /api/message; the page polls GET /api/events for
 * what the agent sends back. Approval requests arrive as messages with "yes"
 * and "no" buttons, the same flow a WhatsApp customer gets.
 */
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatSessions, type Outgoing, type StartConversation } from "../sessions.ts";

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "chat.html");
const MAX_BODY = 8_000;

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw new Error("body too large");
  }
  return JSON.parse(body || "{}") as Record<string, unknown>;
}

export function createWebChat(start: StartConversation): Server {
  const outbox = new Map<string, Outgoing[]>();
  const sessions = new ChatSessions(start, async (userId, message) => {
    outbox.set(userId, [...(outbox.get(userId) ?? []), message]);
  });

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(await readFile(PAGE));
      } else if (req.method === "GET" && url.pathname === "/healthz") {
        json(200, { status: "ok" });
      } else if (req.method === "POST" && url.pathname === "/api/message") {
        const { session, text } = await readJson(req);
        if (typeof session !== "string" || !/^[\w-]{8,64}$/.test(session) || typeof text !== "string" || !text.trim()) return json(400, { error: "session and text are required" });
        void sessions.receive(session, text.trim().slice(0, 2000)); // not awaited: an approval may hold it open
        json(202, { ok: true });
      } else if (req.method === "GET" && url.pathname === "/api/events") {
        const session = url.searchParams.get("session") ?? "";
        const after = Number(url.searchParams.get("after") ?? 0);
        const events = outbox.get(session) ?? [];
        json(200, { events: events.slice(after), next: events.length });
      } else {
        json(404, { error: "not found" });
      }
    } catch (error) {
      json(400, { error: error instanceof Error ? error.message : "bad request" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { hasAnthropicCredentials } = await import("../../rag/kb.ts");
  if (!hasAnthropicCredentials()) {
    console.error("The agent calls the Claude API. Set ANTHROPIC_API_KEY in .env (see .env.example).");
    process.exit(2);
  }
  const { startConversation } = await import("../../agent/index.ts");
  const { createServices } = await import("../../tools/index.ts");
  const services = await createServices();
  const port = Number(process.env.PORT ?? 3100);
  // Only this computer by default. A container sets HOST=0.0.0.0 so the published port can reach it.
  const host = process.env.HOST ?? "127.0.0.1";
  createWebChat((approve) => startConversation({ approve, services })).listen(port, host, () => {
    console.log(`Chat with the agent: http://localhost:${port}`);
  });
}
