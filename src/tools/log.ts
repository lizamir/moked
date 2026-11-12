import { z } from "zod";
import type { RequestLog } from "../services/request-log.ts";
import type { TicketSystem } from "../services/tickets.ts";
import { defineTool } from "./types.ts";

export function logTools(log: RequestLog, tickets?: TicketSystem) {
  return [
    defineTool({
      name: "log_request",
      kind: "action",
      description: "Record a request for the staff to follow up on. Use it when the customer needs something you cannot complete yourself: a boarding or daycare reservation, a complaint, a special case, or a question the knowledge base does not answer and that only the business can settle. Needs the customer's name and a way to reach them (phone or email), given by the customer in this conversation.",
      schema: z.object({
        customer_name: z.string().min(2),
        contact: z.string().min(5).describe("Phone number or email the customer gave"),
        topic: z.string().min(2).describe("A few words, e.g. 'הזמנה לפנסיון'"),
        details: z.string().min(5).describe("What the staff need to know to call back prepared"),
      }),
      summarize: (i) => `לרשום פנייה לצוות על שם ${i.customer_name} (${i.contact}): ${i.topic}`,
      run: async (i) => {
        const request = { customerName: i.customer_name, contact: i.contact, topic: i.topic, details: i.details };
        // The CSV row is written first, so the request survives even when the ticket system is down.
        await log.add(request);
        if (!tickets) return "Recorded. A staff member returns requests within one business day.";
        try {
          const ticket = await tickets.open(request);
          return `Recorded as ticket ${ticket.key}. Give the customer this number. A staff member returns requests within one business day.`;
        } catch {
          return "Recorded for the staff, but the ticket system did not answer, so there is no ticket number to give. A staff member returns requests within one business day.";
        }
      },
    }),
  ];
}
