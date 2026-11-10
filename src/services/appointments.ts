import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { addDays, toMinutes, toTime, weekdayOf, type BusinessProfile, type Clock, type Service } from "./business.ts";

export interface Appointment {
  id: string;
  serviceId: string;
  date: string;
  start: string;
  end: string;
  customerName: string;
  dogName: string;
  customerEmail?: string;
  createdAt: string;
}

export interface BookingRequest {
  serviceId: string;
  date: string;
  time: string;
  customerName: string;
  dogName: string;
  customerEmail?: string;
}

/** A booking the business rules do not allow. The message is safe to show to the customer. */
export class BookingError extends Error {}

/**
 * The salon's appointment book. One groomer, so one appointment at a time.
 *
 * This class owns every booking rule (opening hours, slot grid, conflicts,
 * booking window). The agent cannot break a rule by asking nicely: it can only
 * call `book`, and `book` refuses.
 */
export class AppointmentBook {
  constructor(
    private readonly profile: BusinessProfile,
    private readonly file: string,
    private readonly clock: Clock,
  ) {}

  service(serviceId: string): Service {
    const service = this.profile.services.find((s) => s.id === serviceId);
    if (!service) throw new BookingError(`אין טיפול בשם '${serviceId}'. הטיפולים: ${this.profile.services.map((s) => s.id).join(", ")}`);
    return service;
  }

  async list(): Promise<Appointment[]> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as Appointment[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async get(id: string): Promise<Appointment> {
    const appointment = (await this.list()).find((a) => a.id === id);
    if (!appointment) throw new BookingError(`אין תור עם מספר אישור '${id}'.`);
    return appointment;
  }

  /** Start times on which the service fits entirely inside opening hours and overlaps no existing appointment. */
  async freeSlots(date: string, serviceId: string): Promise<string[]> {
    const service = this.service(serviceId);
    this.assertBookableDate(date);
    const hours = this.profile.hours[weekdayOf(date)];
    if (!hours) return [];
    const [open, close] = [toMinutes(hours[0]), toMinutes(hours[1])];
    const taken = (await this.list()).filter((a) => a.date === date).map((a) => [toMinutes(a.start), toMinutes(a.end)] as const);
    const now = this.clock();
    const slots: string[] = [];
    for (let start = open; start + service.minutes <= close; start += this.profile.slotMinutes) {
      const end = start + service.minutes;
      if (date === now.date && start <= toMinutes(now.time)) continue;
      if (taken.some(([from, to]) => start < to && end > from)) continue;
      slots.push(toTime(start));
    }
    return slots;
  }

  async book(request: BookingRequest): Promise<Appointment> {
    const service = this.service(request.serviceId);
    const free = await this.freeSlots(request.date, request.serviceId);
    if (!free.includes(request.time)) {
      const hours = this.profile.hours[weekdayOf(request.date)];
      if (!hours) throw new BookingError(`המספרה סגורה בתאריך ${request.date}.`);
      throw new BookingError(
        free.length ? `השעה ${request.time} לא פנויה בתאריך ${request.date}. שעות פנויות: ${free.join(", ")}` : `אין שעות פנויות לטיפול הזה בתאריך ${request.date}.`,
      );
    }
    const appointments = await this.list();
    const appointment: Appointment = {
      id: `apt-${String(appointments.length + 1).padStart(4, "0")}`,
      serviceId: service.id,
      date: request.date,
      start: request.time,
      end: toTime(toMinutes(request.time) + service.minutes),
      customerName: request.customerName,
      dogName: request.dogName,
      customerEmail: request.customerEmail,
      createdAt: `${this.clock().date}T${this.clock().time}`,
    };
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify([...appointments, appointment], null, 2));
    return appointment;
  }

  private assertBookableDate(date: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw new BookingError(`התאריך '${date}' לא תקין. הפורמט הוא YYYY-MM-DD.`);
    const today = this.clock().date;
    if (date < today) throw new BookingError(`התאריך ${date} כבר עבר. היום ${today}.`);
    const last = addDays(today, this.profile.bookingWindowDays);
    if (date > last) throw new BookingError(`אפשר לקבוע תור עד ${this.profile.bookingWindowDays} יום מראש, כלומר עד ${last}.`);
  }
}
