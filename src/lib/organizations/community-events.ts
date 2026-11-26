import { z } from "zod";

// Report 34.4 (plan B5.3, M3): community events and the RSVP slice (Going · Can't go, a place limit, a waitlist).
// Client-safe and pure. The online link and place limit live server-side (community_events), never in these fields.

export const EVENT_FORMATS = { in_person: "In person", online: "Online", hybrid: "Hybrid" } as const;
export type EventFormat = keyof typeof EVENT_FORMATS;

// Strict ISO with an offset (security review): anything else could fail the database cast and break the list for everyone.
const iso = z.string().datetime({ offset: true }).refine((v) => { const y = new Date(v).getUTCFullYear(); return y >= 2000 && y <= 2200; }, "date");
export const afterLink = z.object({ label: z.string().trim().min(1).max(80), url: z.string().trim().max(500).regex(/^https:\/\//) }).strict();
export const communityEventSchema = z.object({
  kind: z.literal("community"),
  start: iso,
  end: iso,
  format: z.enum(["in_person", "online", "hybrid"]),
  place: z.string().trim().max(200).nullable(),
  who: z.enum(["members", "public"]),
  hosts: z.array(z.string().uuid()).max(10),
  runOfShow: z.array(z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), title: z.string().trim().min(1).max(120) }).strict()).max(30),
  /** After the event (B5.3c): slides and recordings as links, shown in Past. */
  after: z.array(afterLink).max(10).optional(),
}).strict();
export type CommunityEventFields = z.infer<typeof communityEventSchema>;

/** Layer 2 + edges: an end after the start; in person and hybrid need a place. */
export function eventProblem(f: CommunityEventFields): string | null {
  if (Date.parse(f.end) <= Date.parse(f.start)) return "An event ends after it starts.";
  if (f.format !== "online" && !f.place?.trim()) return "Add where it happens.";
  return null;
}

/** Call 3: Going while there's a place; otherwise the waitlist. Lowering the limit keeps everyone already Going. */
export const placeFor = (limit: number | null, going: number): "going" | "waitlisted" => (limit === null || going < limit ? "going" : "waitlisted");

/** Places left (never below zero), or null with no limit. */
export const placesLeft = (limit: number | null, going: number) => (limit === null ? null : Math.max(0, limit - going));

export type EventState = "published" | "full" | "happening" | "ended" | "cancelled";
/** Layer 11: Published · Full (waitlist open) · Happening now · Ended · Cancelled. */
export function eventState(f: Pick<CommunityEventFields, "start" | "end">, cancelled: boolean, limit: number | null, going: number, now: Date): EventState {
  if (cancelled) return "cancelled";
  const t = now.getTime();
  if (t >= Date.parse(f.end)) return "ended";
  if (t >= Date.parse(f.start)) return "happening";
  return limit !== null && going >= limit ? "full" : "published";
}

/** Edge: an event that has ended (or is cancelled) takes no RSVPs. */
export const canRsvp = (state: EventState) => state === "published" || state === "full" || state === "happening";

/** Open in maps: a plain search link for the typed address; nothing is fetched (agreed change 2). */
export const mapsHref = (place: string) => `https://www.openstreetmap.org/search?query=${encodeURIComponent(place)}`;
