import { z } from "zod";

import { addDaysToDay, isoToZonedInput, zonedInputToIso } from "@/lib/organizations/zoned-time";

// Report 35.5 (plan B6.2c, R4 calls 6–8): lab equipment and booking — slots within the lab's bookable hours, no
// overlaps, a weekly cap per person, training required where the equipment says so, and booking paused while it's Out
// of order. Pure and client-safe.

export const EQUIPMENT_STATUS = { available: "Available", out_of_order: "Out of order", maintenance: "Maintenance" } as const;
export type EquipmentStatus = keyof typeof EQUIPMENT_STATUS;

export const bookingRulesSchema = z.object({
  from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/),
  slotMinutes: z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(240)]),
  weeklyCapHours: z.number().int().min(1).max(80),
}).strict().refine((r) => r.from < r.to, "Bookable hours end after they start.")
  // Review: a cap below one slot would lock everyone out.
  .refine((r) => r.weeklyCapHours * 60 >= r.slotMinutes, "The weekly cap is at least one slot.");
export type BookingRules = z.infer<typeof bookingRulesSchema>;
export const DEFAULT_BOOKING: BookingRules = { from: "08:00", to: "20:00", slotMinutes: 60, weeklyCapHours: 8 };

export const equipmentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  place: z.string().trim().max(80),
  caretakerId: z.string().uuid().nullable(),
  trainingDocId: z.string().uuid().nullable(),
  bookable: z.boolean(),
  notes: z.string().trim().max(1000),
}).strict();

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The slots of one day (YYYY-MM-DD) in the lab's zone, as start/end ISO times. */
export function daySlots(day: string, rules: BookingRules, timeZone: string) {
  const out: Array<{ start: string; end: string; label: string }> = [];
  for (let m = minutes(rules.from); m + rules.slotMinutes <= minutes(rules.to); m += rules.slotMinutes) {
    const endM = m + rules.slotMinutes;
    const endLocal = endM >= 1440 ? `${addDaysToDay(day, 1)}T00:00` : `${day}T${hhmm(endM)}`;
    const start = zonedInputToIso(`${day}T${hhmm(m)}`, timeZone);
    const end = zonedInputToIso(endLocal, timeZone);
    // Review: on a clock-change day, a slot that isn't exactly its length, or doesn't start at its own wall time, isn't offered.
    if (Date.parse(end) - Date.parse(start) !== rules.slotMinutes * 60_000 || isoToZonedInput(start, timeZone).slice(0, 16) !== `${day}T${hhmm(m)}`) continue;
    out.push({ start, end, label: `${hhmm(m)}–${hhmm(endM === 1440 ? 0 : endM)}` });
  }
  return out;
}

/** A booking must be exactly one of the day's slots (call 7): never off-grid, never outside bookable hours. */
export function isSlot(startIso: string, rules: BookingRules, timeZone: string) {
  const local = isoToZonedInput(startIso, timeZone);
  return daySlots(local.slice(0, 10), rules, timeZone).find((s) => s.start === new Date(startIso).toISOString()) ?? null;
}

/** The Monday-to-Sunday week (lab's zone) a moment falls in, as ISO bounds — for the weekly cap. */
export function weekBounds(iso: string, timeZone: string) {
  const day = isoToZonedInput(iso, timeZone).slice(0, 10);
  const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDaysToDay(day, -dow);
  return { start: zonedInputToIso(`${monday}T00:00`, timeZone), end: zonedInputToIso(`${addDaysToDay(monday, 7)}T00:00`, timeZone) };
}

/** A calendar file for a booking (call 7: ".ics"), with the equipment and place. */
export function bookingIcs(b: { id: string; start: string; end: string; equipment: string; place: string | null; lab: string }) {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (t: string) => t.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r\n?|\n/g, "\\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NetworkBase//Lab booking//EN", "BEGIN:VEVENT", `UID:${b.id}@networkbase.in`, `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(b.start)}`, `DTEND:${stamp(b.end)}`, `SUMMARY:${esc(`${b.equipment} (${b.lab})`)}`, ...(b.place ? [`LOCATION:${esc(b.place)}`] : []), "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}
