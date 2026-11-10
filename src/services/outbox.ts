import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Attachment {
  filename: string;
  contentType: string;
  content: string;
}

export interface Email {
  to: string;
  subject: string;
  body: string;
  attachments?: Attachment[];
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
    await writeFile(path.join(this.dir, `${id}.eml`), toMime(email, this.from, id));
    return { id, delivered: false };
  }
}

/** RFC 2047 encoded-word, so a Hebrew subject survives any mail client. */
const encodeHeader = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`);
const base64Lines = (value: string) => Buffer.from(value).toString("base64").replace(/.{76}/g, "$&\r\n");

/** The message as a standard .eml file: opens in Mail or Outlook, attachments included. */
export function toMime(email: Email, from: string, id: string): string {
  const headers = [`From: ${from}`, `To: ${email.to}`, `Subject: ${encodeHeader(email.subject)}`, "MIME-Version: 1.0"];
  const textPart = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Lines(email.body)];
  if (!email.attachments?.length) return [...headers, ...textPart, ""].join("\r\n");

  const boundary = `moked-${id}`;
  const parts = [
    textPart,
    ...email.attachments.map((file) => [
      `Content-Type: ${file.contentType}; name="${file.filename}"`,
      `Content-Disposition: attachment; filename="${file.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(file.content),
    ]),
  ];
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.flatMap((part) => [`--${boundary}`, ...part]),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
