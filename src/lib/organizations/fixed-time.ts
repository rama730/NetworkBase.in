import { z } from "zod";

/**
 * Report 37.4 (plan B8.2a, X3): a team for a fixed time — an organization with a key date (the event day, launch or
 * deadline) and an end date (30 days after by default). Plan starters lay tasks out with offsets from the key date;
 * moving the key date moves those tasks, and a date someone changed by hand stays (18.2's rule): a task moves only while
 * its date is still the one the plan worked out. It never closes on its own.
 */
const DAY = 86_400_000;
export const fixedTimeSchema = z.object({
  keyDate: z.string().date(),
  endDate: z.string().date(),
}).strict().refine((d) => d.endDate >= d.keyDate, "The end date is on or after the key date.");
export type Workstream = { id: string; name: string; owner: string | null };
export type Debrief = { summary: string; well: string; wrong: string; next: string };
export type FixedTime = z.infer<typeof fixedTimeSchema> & { starter?: string | null; moves?: Array<{ from: string; to: string; reason: string | null; at: string }>; workstreams?: Workstream[];
  /** B8.2c: the wrap-up checklist, this run's debrief, and last run's debrief pinned by Run it again. */
  wrap?: { thank?: boolean; photos?: boolean; report?: boolean }; debrief?: Debrief | null; pinned?: (Debrief & { from: string }) | null };
export function readFixedTime(orgSettings: unknown): FixedTime | null {
  const raw = (orgSettings as { fixedTime?: Record<string, unknown> } | null)?.fixedTime;
  const p = fixedTimeSchema.safeParse(raw ? { keyDate: raw.keyDate, endDate: raw.endDate } : null);
  return p.success ? { ...p.data, starter: typeof raw!.starter === "string" ? raw!.starter : null, moves: Array.isArray(raw!.moves) ? (raw!.moves as FixedTime["moves"]) : [],
    workstreams: Array.isArray(raw!.workstreams) ? (raw!.workstreams as Workstream[]) : [],
    wrap: (raw!.wrap as FixedTime["wrap"]) ?? {}, debrief: (raw!.debrief as Debrief | undefined) ?? null, pinned: (raw!.pinned as FixedTime["pinned"]) ?? null } : null;
}
export const defaultEnd = (keyDate: string) => new Date(Date.parse(`${keyDate}T00:00:00Z`) + 30 * DAY).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** The countdown line's state: Planning, This week (the final 7 days), Today, Wrap-up, or Ended (until someone closes it). */
export function countdown(f: Pick<FixedTime, "keyDate" | "endDate">, today: string) {
  const toKey = between(today, f.keyDate);
  if (toKey > 7) return { state: "planning" as const, line: `${toKey} days to go` };
  if (toKey > 0) return { state: "this_week" as const, line: toKey === 1 ? "1 day to go" : `${toKey} days to go` };
  if (toKey === 0) return { state: "today" as const, line: "Today" };
  const left = between(today, f.endDate);
  if (left >= 0) return { state: "wrap_up" as const, line: left === 0 ? "Wrap-up: last day" : left === 1 ? "Wrap-up: 1 day left" : `Wrap-up: ${left} days left` };
  return { state: "ended" as const, line: "Ended" };
}
/** Offsets as words ("14 days before", "On the day", "2 days after"). */
export const offsetWords = (n: number) => (n === 0 ? "On the day" : `${Math.abs(n)} ${Math.abs(n) === 1 ? "day" : "days"} ${n < 0 ? "before" : "after"}`);

export type StarterTask = { phase: string; title: string; offset: number };
/** Plan starters: phases and tasks with offsets from the key date (Event: 8 weeks before to 2 weeks after). */
export const STARTERS: Record<string, { name: string; tasks: StarterTask[] }> = {
  event: { name: "Event", tasks: [
    { phase: "Plan", title: "Agree the goal, audience and size", offset: -56 }, { phase: "Plan", title: "Pick the venue and the date", offset: -49 },
    { phase: "Book", title: "Book the venue", offset: -42 }, { phase: "Book", title: "Book sound and equipment", offset: -35 }, { phase: "Book", title: "Apply for permits", offset: -35 },
    { phase: "Promote", title: "Announce the event", offset: -28 }, { phase: "Promote", title: "Open sign-ups", offset: -21 },
    { phase: "Final week", title: "Volunteer briefing", offset: -14 }, { phase: "Final week", title: "Print the map and signs", offset: -10 }, { phase: "Final week", title: "Confirm every booking", offset: -7 },
    { phase: "The day", title: "Run of show", offset: 0 },
    { phase: "Wrap-up", title: "Thank volunteers and partners", offset: 2 }, { phase: "Wrap-up", title: "Collect photos and files", offset: 7 }, { phase: "Wrap-up", title: "Debrief", offset: 14 }] },
  campaign: { name: "Campaign", tasks: [
    { phase: "Plan", title: "Agree the goal and audience", offset: -42 }, { phase: "Plan", title: "Write the message", offset: -35 },
    { phase: "Make", title: "Make the materials", offset: -21 }, { phase: "Make", title: "Line up partners", offset: -14 },
    { phase: "Launch", title: "Launch", offset: 0 }, { phase: "Run", title: "Mid-campaign check", offset: 14 }, { phase: "Wrap-up", title: "Debrief", offset: 30 }] },
  task_force: { name: "Task force", tasks: [
    { phase: "Start", title: "Agree the question and the deadline", offset: -42 }, { phase: "Work", title: "Gather what’s known", offset: -35 },
    { phase: "Work", title: "Draft the recommendation", offset: -14 }, { phase: "Work", title: "Review with stakeholders", offset: -7 },
    { phase: "Deliver", title: "Hand in the recommendation", offset: 0 }, { phase: "Wrap-up", title: "Debrief", offset: 7 }] },
};

/**
 * B8.2b (37.4 calls 2–3): workstreams (each with an owner), Bookings (a task with a supplier and a typed reference;
 * NetworkBase never books or pays) and Issues today (tasks marked Issue, shown on the day).
 */
export const workstreamsSchema = z.array(z.object({ id: z.string().regex(/^[a-z0-9-]{1,30}$/), name: z.string().trim().min(1).max(40), owner: z.string().uuid().nullable() }).strict()).max(12);
export const BOOKING_STATES = ["to_book", "applied", "confirmed", "cancelled"] as const;
export type BookingState = (typeof BOOKING_STATES)[number];
export const BOOKING_WORDS: Record<BookingState, string> = { to_book: "To book", applied: "Applied", confirmed: "Confirmed", cancelled: "Cancelled" };
export type Booking = { supplier: string; ref: string; state: BookingState; workstream: string | null };
export const bookingSchema = z.object({ supplier: z.string().trim().max(120), ref: z.string().trim().max(60), state: z.enum(BOOKING_STATES), workstream: z.string().max(30).nullable() }).strict()
  .refine((b) => b.state !== "confirmed" || b.ref.length > 0, "A confirmed booking has its reference.");

/** B8.2c (call 5): the wrap-up checklist — thank volunteers, collect photos and files, the debrief, an optional report. */
export const WRAP_ITEMS = [{ id: "thank", label: "Thank volunteers and partners" }, { id: "photos", label: "Collect photos and files" }, { id: "debrief", label: "Debrief" }, { id: "report", label: "Report (optional)" }] as const;
export const debriefSchema = z.object({ summary: z.string().trim().min(1).max(2000), well: z.string().trim().max(2000), wrong: z.string().trim().max(2000), next: z.string().trim().max(2000) }).strict();
/** Run it again: the copy keeps the dates' distance from a new key date, the workstream names (no owners: no people are copied), and last run's debrief pinned. */
export function carryOver(f: FixedTime, newKey: string, fromTitle: string) {
  const delta = Math.round((Date.parse(`${newKey}T00:00:00Z`) - Date.parse(`${f.keyDate}T00:00:00Z`)) / DAY);
  return { keyDate: newKey, endDate: addDays(f.endDate, delta), workstreams: (f.workstreams ?? []).map((w) => ({ ...w, owner: null })),
    pinned: f.debrief ? { ...f.debrief, from: fromTitle } : f.pinned ?? null };
}
/** "Next time" lines become tasks in the next run. */
export const nextTimeTasks = (d: Debrief | null | undefined) => (d?.next ?? "").split(/\n+/).map((l) => l.replace(/^[-*•\s]+/, "").trim()).filter(Boolean).slice(0, 20);
