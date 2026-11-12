import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface AuditEvent {
  tool: string;
  kind: "read" | "action" | "web";
  /** ok: ran. declined: the customer said no. invalid / error: it did not run. */
  outcome: "ok" | "declined" | "invalid" | "error";
}

/**
 * The record of everything the agent did: one JSON line per tool call, with
 * the time and the outcome. It answers "what did the AI do, and was it
 * approved?" after the fact. It stores no message text and no tool input, so
 * it holds no customer details.
 */
export class AuditLog {
  constructor(private readonly file: string) {}

  async record(event: AuditEvent): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const line = { time: new Date().toISOString(), tool: event.tool, kind: event.kind, outcome: event.outcome };
    await appendFile(this.file, `${JSON.stringify(line)}\n`);
  }
}
