import { z } from "zod";

// Report 36.2 (plan B7.1a, L1): a club's recruiting period — dates, a banner line and the first event to point to. It
// shows Recruiting now on About and in Discover and switches itself off after the end date. Pure and client-safe.

export const recruitingSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  line: z.string().trim().max(160),
  firstEventId: z.string().uuid().nullable(),
}).strict().refine((r) => r.to >= r.from, "ends after it starts");
export type Recruiting = z.infer<typeof recruitingSchema>;

export function readRecruiting(orgSettings: unknown): Recruiting | null {
  const raw = (orgSettings as { club?: { recruiting?: unknown } } | null)?.club?.recruiting;
  const p = recruitingSchema.safeParse(raw);
  return p.success ? p.data : null;
}

/** Call 3: recruiting from the start date through the end date (the day, in UTC); off on its own after that. */
export const isRecruiting = (r: Recruiting | null, today: string) => Boolean(r && r.from <= today && today <= r.to);
