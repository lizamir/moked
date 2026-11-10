import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Email {
  to: string;
  subject: string;
  body: string;
}

/** Anything that can deliver an email. Swap in a Gmail or SMTP implementation without touching the agent. */
export interface Mailer {
  send(email: Email): Promise<{ id: string; delivered: boolean }>;
}

/**
 * Development mailer: writes each message to a file instead of sending it.
 * `delivered: false` travels back to the agent so it never tells a customer
 * that an email arrived when it did not.
 */
export class FileOutbox implements Mailer {
  private count = 0;

  constructor(
    private readonly dir: string,
    private readonly from: string,
  ) {}

  async send(email: Email): Promise<{ id: string; delivered: boolean }> {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.to)) throw new Error(`כתובת המייל '${email.to}' לא תקינה.`);
    await mkdir(this.dir, { recursive: true });
    const id = `mail-${Date.now()}-${++this.count}`;
    const text = [`From: ${this.from}`, `To: ${email.to}`, `Subject: ${email.subject}`, "", email.body, ""].join("\n");
    await writeFile(path.join(this.dir, `${id}.eml`), text);
    return { id, delivered: false };
  }
}
