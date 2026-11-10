import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AppointmentBook, BookingError } from "../src/services/appointments.ts";
import { addDays, loadProfile, weekdayOf } from "../src/services/business.ts";
import { FileOutbox } from "../src/services/outbox.ts";
import { RequestLog } from "../src/services/request-log.ts";

const profile = await loadProfile();
// 2026-11-15 is a Sunday; the clock reads 10:00.
const clock = () => ({ date: "2026-11-15", time: "10:00" });
const sandbox = () => mkdtemp(path.join(tmpdir(), "moked-test-"));
const newBook = async () => new AppointmentBook(profile, path.join(await sandbox(), "appointments.json"), clock);
const dana = { customerName: "דנה לוי", dogName: "לוקי" };

test("date helpers", () => {
  assert.equal(weekdayOf("2026-11-15"), "sunday");
  assert.equal(weekdayOf("2026-11-21"), "saturday");
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
});

test("free slots follow opening hours and the service length", async () => {
  const book = await newBook();
  const monday = await book.freeSlots("2026-11-16", "groom-large"); // 150 minutes, open 09:00-18:00
  assert.equal(monday[0], "09:00");
  assert.equal(monday.at(-1), "15:30");
  const friday = await book.freeSlots("2026-11-20", "bath"); // 60 minutes, open 08:00-13:00
  assert.equal(friday.at(-1), "12:00");
  assert.deepEqual(await book.freeSlots("2026-11-21", "bath"), []); // Saturday: closed
});

test("today's slots that already started are not offered", async () => {
  const today = await (await newBook()).freeSlots("2026-11-15", "nails");
  assert.equal(today[0], "10:30");
});

test("booking takes the slot and blocks every overlapping one", async () => {
  const book = await newBook();
  const appointment = await book.book({ serviceId: "groom-small", date: "2026-11-16", time: "10:00", ...dana }); // until 11:30
  assert.deepEqual([appointment.id, appointment.start, appointment.end], ["apt-0001", "10:00", "11:30"]);
  const free = await book.freeSlots("2026-11-16", "nails");
  assert.ok(free.includes("09:30"));
  assert.ok(!free.includes("10:00") && !free.includes("11:00"));
  assert.ok(free.includes("11:30"));
  await assert.rejects(book.book({ serviceId: "bath", date: "2026-11-16", time: "10:30", ...dana }), BookingError);
  assert.equal((await book.list()).length, 1);
});

test("the appointment book refuses what the business rules forbid", async () => {
  const book = await newBook();
  const attempt = (date: string, time: string, serviceId = "bath") => book.book({ serviceId, date, time, ...dana });
  await assert.rejects(attempt("2026-11-21", "10:00"), /סגורה/); // Saturday
  await assert.rejects(attempt("2026-11-14", "10:00"), /עבר/); // yesterday
  await assert.rejects(attempt("2026-11-16", "17:30"), BookingError); // would end after closing
  await assert.rejects(attempt("2026-11-16", "10:10"), BookingError); // off the 30-minute grid
  await assert.rejects(attempt("2027-01-20", "10:00"), /30 יום/); // beyond the booking window
  await assert.rejects(attempt("2026-11-16", "10:00", "massage"), /אין טיפול/);
  assert.equal((await book.list()).length, 0);
});

test("the development mailer writes a file and reports that nothing was delivered", async () => {
  const dir = await sandbox();
  const outbox = new FileOutbox(dir, "hello@parva.example");
  const result = await outbox.send({ to: "noa@example.com", subject: "אישור תור", body: "התור נקבע." });
  assert.equal(result.delivered, false);
  const [file] = await readdir(dir);
  assert.match(await readFile(path.join(dir, file!), "utf8"), /To: noa@example\.com\nSubject: אישור תור\n\nהתור נקבע\./);
  await assert.rejects(outbox.send({ to: "not-an-email", subject: "x", body: "y" }), /לא תקינה/);
});

test("the request log is a CSV that survives quotes, commas and formulas", async () => {
  const file = path.join(await sandbox(), "requests.csv");
  const log = new RequestLog(file, clock);
  await log.add({ customerName: "מיכל", contact: "050-5550123", topic: "פנסיון", details: 'רקס, "גדול", 1 עד 5 בדצמבר' });
  await log.add({ customerName: "=HYPERLINK(1)", contact: "a@b.co", topic: "x", details: "y" });
  const [header, first, second] = (await readFile(file, "utf8")).trim().split("\n");
  assert.equal(header, "time,customer_name,contact,topic,details");
  assert.equal(first, '"2026-11-15 10:00","מיכל","050-5550123","פנסיון","רקס, ""גדול"", 1 עד 5 בדצמבר"');
  assert.match(second!, /"'=HYPERLINK\(1\)"/);
});
