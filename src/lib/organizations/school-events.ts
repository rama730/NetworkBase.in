import { z } from "zod";

import { dayKind, type SchoolYear } from "@/lib/organizations/school-year";

/**
 * Report 32.2 S1 calls 3–5, 8–9 (plan B3.1b): school events, pure. An event is an `event` item (never on the board, no
 * registration or budget) with a type, an audience (everyone, some classes, or some roles — the announcement model),
 * a place, a status and an optional weekly repeat that skips holidays and staff days. Public only when marked.
 */
export const EVENT_TYPES = { meeting: "Meeting", deadline: "Deadline", event: "Event", parents: "Parents’ evening", trip: "Trip", assessment: "Assessment" } as const;
export type EventType = keyof typeof EVENT_TYPES;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const eventFieldsSchema = z.object({
  type: z.enum(Object.keys(EVENT_TYPES) as [EventType, ...EventType[]]).default("event"),
  date: z.string().date(),
  time: z.string().regex(TIME).nullable().default(null),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  place: z.string().trim().max(120).default(""),
  audience: z.object({ mode: z.enum(["everyone", "classes", "roles"]), classIds: z.array(z.string().uuid()).max(200).default([]), roles: z.array(z.enum(["admin", "member"])).max(2).default([]) })
    .default({ mode: "everyone", classIds: [], roles: [] }),
  repeat: z.object({ every: z.number().int().min(1).max(8), until: z.string().date() }).nullable().default(null),
  public: z.boolean().default(false),
}).strict();
export type EventFields = z.infer<typeof eventFieldsSchema>;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The days an event happens on within [from, to]: its date (or range start), and its weekly repeats skipping holidays and staff days (call 5). */
export function occurrences(e: Pick<EventFields, "date" | "repeat">, from: string, to: string, year: SchoolYear | null) {
  const out: string[] = [];
  if (!e.repeat) return e.date >= from && e.date <= to ? [e.date] : [];
  // Security review: at most 60 weeks of repeats are ever walked.
  for (let d = e.date, n = 0; d <= e.repeat.until && d <= to && n < 60; d = addDays(d, 7 * e.repeat.every), n++) {
    if (d < from) continue;
    const kind = year ? dayKind(d, year) : "school";
    if (kind === "holiday" || kind === "staff") continue;
    out.push(d);
  }
  return out;
}

/** For me (call 4): everyone; my class is in it; or my role in the school is. */
export function forMe(audience: EventFields["audience"], me: { classIds: string[]; role: "owner" | "admin" | "member" | "viewer" | null }) {
  if (audience.mode === "everyone") return true;
  if (audience.mode === "classes") return audience.classIds.some((id) => me.classIds.includes(id));
  const role = me.role === "owner" ? "admin" : me.role;
  return role === "admin" || role === "member" ? audience.roles.includes(role) : false;
}

export const EVENT_STATUS = { planned: "Planned", confirmed: "Confirmed", done: "Done", cancelled: "Cancelled" } as const;
