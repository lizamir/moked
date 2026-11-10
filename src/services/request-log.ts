import { appendFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Clock } from "./business.ts";

export interface CustomerRequest {
  customerName: string;
  contact: string;
  topic: string;
  details: string;
}

const HEADER = ["time", "customer_name", "contact", "topic", "details"];
/** Quote every cell, and neutralise a leading = + - @ so a spreadsheet never runs customer text as a formula. */
const cell = (value: string) => `"${value.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;

/** Requests the staff should follow up on, as a CSV that opens in any spreadsheet. */
export class RequestLog {
  constructor(
    private readonly file: string,
    private readonly clock: Clock,
  ) {}

  async add(request: CustomerRequest): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const exists = await stat(this.file).then(() => true, () => false);
    const now = this.clock();
    const row = [`${now.date} ${now.time}`, request.customerName, request.contact, request.topic, request.details].map(cell).join(",");
    await appendFile(this.file, (exists ? "" : `${HEADER.join(",")}\n`) + `${row}\n`);
  }
}
