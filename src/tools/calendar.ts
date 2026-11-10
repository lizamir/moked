import { z } from "zod";
import type { AppointmentBook } from "../services/appointments.ts";
import type { BusinessProfile } from "../services/business.ts";
import { defineTool } from "./types.ts";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Calendar date as YYYY-MM-DD");

export function calendarTools(book: AppointmentBook, profile: BusinessProfile) {
  const serviceId = z.enum(profile.services.map((s) => s.id) as [string, ...string[]]).describe("Service id from the list in your instructions");
  return [
    defineTool({
      name: "check_availability",
      kind: "read",
      description: "List the free start times for one salon service on one date, from the live appointment book. Use it before offering or booking a time, and whenever the customer asks when there is room. Opening hours in the knowledge base say when the salon is open, not which times are still free; only this tool knows that.",
      schema: z.object({ service_id: serviceId, date }),
      run: async ({ service_id, date }) => {
        const slots = await book.freeSlots(date, service_id);
        return slots.length ? `Free start times on ${date}: ${slots.join(", ")}` : `No free times on ${date} for this service.`;
      },
    }),
    defineTool({
      name: "book_appointment",
      kind: "action",
      description: "Book a salon appointment. Use it when the customer wants to book and you have every detail from them: service, date, time, their name and the dog's name. Ask for whatever is missing first; never guess a name or pick a time they did not choose. Salon services only: boarding and daycare are arranged by staff, so use log_request for those.",
      schema: z.object({
        service_id: serviceId,
        date,
        time: z.string().regex(/^\d{2}:\d{2}$/).describe("Start time as HH:MM, one of the free times"),
        customer_name: z.string().min(2),
        dog_name: z.string().min(1),
        customer_email: z.string().email().optional().describe("Only if the customer gave one"),
      }),
      summarize: (i) => `לקבוע תור: ${book.service(i.service_id).name}, בתאריך ${i.date} בשעה ${i.time}, על שם ${i.customer_name} (${i.dog_name})`,
      run: async (i) => {
        const a = await book.book({ serviceId: i.service_id, date: i.date, time: i.time, customerName: i.customer_name, dogName: i.dog_name, customerEmail: i.customer_email });
        const service = book.service(a.serviceId);
        return `Booked. Confirmation ${a.id}: ${service.name}, ${a.date} ${a.start}-${a.end}, ${service.price} ILS, for ${a.customerName} (${a.dogName}).`;
      },
    }),
  ];
}
