import { z } from "zod";

/**
 * Report 37.3 (plan B8.1a, X2): volunteers and shifts for an organization of type Other with the Volunteers part on.
 * Roles (some need a training sign-off), a versioned volunteer agreement, shifts with a role, place, time and places that
 * reuse M3's RSVP slice (place limit, a waitlist that moves up), check-in in a window, and hours from checked-in shifts.
 * No scores, ranks or "top volunteer"; contact is Message only.
 */
export const volunteerRoleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,30}$/),
  name: z.string().trim().min(1).max(60),
  line: z.string().trim().max(200),
  training: z.boolean(),
}).strict();
export type VolunteerRole = z.infer<typeof volunteerRoleSchema>;
export const volunteersSchema = z.object({
  on: z.boolean(),
  roles: z.array(volunteerRoleSchema).max(30),
  agreement: z.object({ text: z.string().trim().max(5000), version: z.number().int().min(0) }).strict(),
}).strict();
export type VolunteerSettings = z.infer<typeof volunteersSchema>;
export const DEFAULT_VOLUNTEERS: VolunteerSettings = { on: false, roles: [], agreement: { text: "", version: 0 } };
export function readVolunteers(orgSettings: unknown): VolunteerSettings {
  const p = volunteersSchema.safeParse((orgSettings as { volunteers?: unknown } | null)?.volunteers);
  return p.success ? p.data : DEFAULT_VOLUNTEERS;
}
/** Volunteers is for organizations of type Other (kits switch it on later, B8.4). */
export const volunteersFor = (orgType: string | null | undefined) => orgType === "other";

export const shiftSchema = z.object({
  roleId: z.string().regex(/^[a-z0-9-]{1,30}$/),
  place: z.string().trim().max(120),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  places: z.number().int().min(1).max(500),
  note: z.string().trim().max(500),
  /** B8.3a (37.5 call 4): the program this shift serves, so its hours count toward the program's measures. */
  programId: z.string().uuid().nullable().optional(),
}).strict().refine((s) => Date.parse(s.end) > Date.parse(s.start) && Date.parse(s.end) - Date.parse(s.start) <= 24 * 3_600_000, "A shift ends after it starts, within a day.");
export type Shift = z.infer<typeof shiftSchema>;
export type ShiftFields = Omit<Shift, "places"> & { kind: "shift"; series?: string };

const MIN = 60_000;
/** Self check-in: from 15 minutes before the shift starts until 30 minutes after. */
export const checkInOpen = (start: string, now = Date.now()) => now >= Date.parse(start) - 15 * MIN && now <= Date.parse(start) + 30 * MIN;
/** Coordinators tick names from an hour before until the day after it ends. */
export const coordinatorCheckIn = (start: string, end: string, now = Date.now()) => now >= Date.parse(start) - 60 * MIN && now <= Date.parse(end) + 24 * 60 * MIN;
/** A shift starting within 14 days with fewer people going than places is Short. */
export const isShort = (start: string, going: number, places: number, now = Date.now()) => going < places && Date.parse(start) > now && Date.parse(start) - now <= 14 * 24 * 60 * MIN;
/** Hours from checked-in shifts: each shift's length. */
export const shiftHours = (shifts: Array<{ start: string; end: string }>) => Math.round(shifts.reduce((n, s) => n + (Date.parse(s.end) - Date.parse(s.start)) / 3_600_000, 0) * 10) / 10;
