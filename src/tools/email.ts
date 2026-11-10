import { z } from "zod";
import type { Mailer } from "../services/outbox.ts";
import { defineTool } from "./types.ts";

export function emailTools(mailer: Mailer) {
  return [
    defineTool({
      name: "send_email",
      kind: "action",
      description: "Send an email to the customer: a booking confirmation, a summary of what was discussed, or information they asked to receive in writing. Use it when the customer asks for something by email and has given the address in this conversation. Never invent or guess an address; ask for it. Write the email in Hebrew, with only facts that came from the knowledge base or from a tool result.",
      schema: z.object({
        to: z.string().email().describe("The address the customer gave"),
        subject: z.string().min(3),
        body: z.string().min(10),
      }),
      summarize: (i) => `לשלוח מייל אל ${i.to} בנושא "${i.subject}"`,
      run: async (i) => {
        const result = await mailer.send(i);
        return result.delivered
          ? `Email sent to ${i.to} (${result.id}).`
          : `Email to ${i.to} was written to the outbox (${result.id}) but NOT delivered: this installation has no mail server connected. Tell the customer the email was prepared, not that it arrived.`;
      },
    }),
  ];
}
