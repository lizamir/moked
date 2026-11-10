import { z } from "zod";
import type { RequestLog } from "../services/request-log.ts";
import { defineTool } from "./types.ts";

export function logTools(log: RequestLog) {
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
        await log.add({ customerName: i.customer_name, contact: i.contact, topic: i.topic, details: i.details });
        return "Recorded. A staff member returns requests within one business day.";
      },
    }),
  ];
}
