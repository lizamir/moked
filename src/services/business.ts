import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** Everything specific to one business lives in this folder. Point it elsewhere to run a different business. */
export const BUSINESS_DIR = process.env.MOKED_BUSINESS_DIR ?? path.join(ROOT, "business");
/** Files the agent writes while running: bookings, outgoing mail, the request log. Never committed. */
export const RUNTIME_DIR = process.env.MOKED_RUNTIME_DIR ?? path.join(ROOT, "data/runtime");

export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const time = z.string().regex(/^\d{2}:\d{2}$/);
const ProfileSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  email: z.string(),
  address: z.string(),
  timezone: z.string(),
  slotMinutes: z.number().int().positive(),
  bookingWindowDays: z.number().int().positive(),
  hours: z.record(z.enum(WEEKDAYS), z.tuple([time, time]).nullable()),
  services: z.array(z.object({ id: z.string(), name: z.string(), minutes: z.number().int().positive(), price: z.number() })).min(1),
});
export type BusinessProfile = z.infer<typeof ProfileSchema>;
export type Service = BusinessProfile["services"][number];

export async function loadProfile(dir = BUSINESS_DIR): Promise<BusinessProfile> {
  return ProfileSchema.parse(JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8")));
}

/** The current date and time on the business's wall clock. */
export interface Now {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
}
export type Clock = () => Now;

export function systemClock(timezone: string): Clock {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return () => {
    const parts = Object.fromEntries(format.formatToParts(new Date()).map((p) => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  };
}

// Calendar dates are handled as plain YYYY-MM-DD strings, so no time zone can shift a booking to the wrong day.
export const weekdayOf = (date: string): Weekday => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
export const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
export const toTime = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
