import type { Appointment } from "./appointments.ts";
import type { BusinessProfile, Service } from "./business.ts";

/** "2026-11-16" + "10:00" -> "20261116T100000", a wall-clock time read in the TZID given next to it. */
const icsTime = (date: string, time: string) => `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
/** Commas, semicolons and backslashes are separators in iCalendar text, and newlines must be escaped. */
const icsText = (value: string) => value.replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");

/**
 * A calendar invite (iCalendar, RFC 5545) for one appointment. Opening the
 * .ics file in Google Calendar, Outlook or Apple Calendar adds the event.
 */
export function appointmentInvite(appointment: Appointment, service: Service, profile: BusinessProfile, stamp: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//moked//appointments//HE",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${appointment.id}-${appointment.date}@moked`,
    `DTSTAMP:${stamp.replace(/[-:]/g, "").slice(0, 13)}00`,
    `DTSTART;TZID=${profile.timezone}:${icsTime(appointment.date, appointment.start)}`,
    `DTEND;TZID=${profile.timezone}:${icsTime(appointment.date, appointment.end)}`,
    `SUMMARY:${icsText(`${service.name}: ${appointment.dogName}, ${profile.name}`)}`,
    `LOCATION:${icsText(profile.address)}`,
    `DESCRIPTION:${icsText(`תור ${appointment.id} על שם ${appointment.customerName}. מחיר: ${service.price} ₪. ביטול חינם עד 24 שעות לפני התור.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}
