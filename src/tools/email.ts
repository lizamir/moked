import { z } from "zod";
import type { AppointmentBook } from "../services/appointments.ts";
import type { BusinessProfile, Clock } from "../services/business.ts";
import { appointmentInvite } from "../services/calendar-invite.ts";
import type { Mailer } from "../services/outbox.ts";
import { defineTool } from "./types.ts";

export function emailTools(mailer: Mailer, book: AppointmentBook, profile: BusinessProfile, clock: Clock) {
  return [
    defineTool({
      name: "send_email",
      kind: "action",
      description:
        "Send an email to the customer: a booking confirmation, a summary of what was discussed, or information they asked to receive in writing. Use it when the customer asks for something by email and has given the address in this conversation. Never invent or guess an address; ask for it. Write the email in Hebrew, with only facts that came from the knowledge base or from a tool result. For a booking confirmation, pass the confirmation id from book_appointment as invite_appointment_id: the email then carries a calendar invite the customer can add to their calendar in one tap.",
      schema: z.object({
        to: z.string().email().describe("The address the customer gave"),
        subject: z.string().min(3),
        body: z.string().min(10),
        invite_appointment_id: z.string().optional().describe("Confirmation id from book_appointment, e.g. 'apt-0001', to attach a calendar invite"),
      }),
      summarize: (i) => `לשלוח מייל אל ${i.to} בנושא "${i.subject}"${i.invite_appointment_id ? ", עם זימון ליומן" : ""}`,
      run: async (i) => {
        const attachments = [];
        if (i.invite_appointment_id) {
          const appointment = await book.get(i.invite_appointment_id);
          const now = clock();
          attachments.push({
            filename: "invite.ics",
            contentType: "text/calendar; charset=UTF-8; method=PUBLISH",
            content: appointmentInvite(appointment, book.service(appointment.serviceId), profile, `${now.date}T${now.time}`),
          });
        }
        const result = await mailer.send({ to: i.to, subject: i.subject, body: i.body, attachments });
        const invite = attachments.length ? " with a calendar invite attached" : "";
        return result.delivered
          ? `Email sent to ${i.to}${invite} (${result.id}).`
          : `Email to ${i.to}${invite} was written to the outbox (${result.id}) but NOT delivered: this installation has no mail server connected. Tell the customer the email was prepared, not that it arrived.`;
      },
    }),
  ];
}
