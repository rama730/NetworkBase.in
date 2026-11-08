import { LAST_ACTIVE_HERE_SINCE } from "@/lib/organizations/member-rules";

// Ask to take over (report §45.2, decision 170): pure, so Settings and the server agree. No scheduled job: the
// 30 days away and the 7 days to refuse are checked when Settings opens.

export const OWNER_AWAY_DAYS = 30;
export const REFUSE_DAYS = 7;
/** A request ends 14 days after it was made (audit N4, decision D-B): an old ask can't be used months later. */
export const REQUEST_DAYS = 14;
const DAY_MS = 86_400_000;

/** The owner hasn't been active in the organization for 30 days. Before Last active here has run that long, never. */
export function ownerAway(lastActiveHere: Date | null, now: Date = new Date(), since: Date = LAST_ACTIVE_HERE_SINCE) {
  const cutoff = now.getTime() - OWNER_AWAY_DAYS * DAY_MS;
  return (lastActiveHere?.getTime() ?? since.getTime()) < cutoff;
}

export type TakeoverState =
  | { state: "hidden" }
  | { state: "can_ask" }
  | { state: "asked_by_other"; by: string }
  | { state: "waiting"; refuseBy: string }
  | { state: "ready" }
  | { state: "owner_can_refuse"; by: string; refuseBy: string };

/** What a viewer sees in Settings → Management → Ownership. */
export function takeoverState(input: {
  viewer: { id: string; role: "owner" | "admin" | "member" | "viewer" };
  ownerLastActiveHere: Date | null;
  /** byIsAdmin false: the asker left, was removed or demoted, so the request no longer counts (audit 3.7). */
  request: { by: string; byName: string; at: Date; byIsAdmin?: boolean } | null;
  now?: Date;
  since?: Date;
}): TakeoverState {
  const now = input.now ?? new Date();
  const { viewer } = input;
  const request = input.request && input.request.byIsAdmin !== false && !requestExpired(input.request.at, now) ? input.request : null;
  const refuseBy = request ? new Date(request.at.getTime() + REFUSE_DAYS * DAY_MS) : null;
  if (viewer.role === "owner") return request ? { state: "owner_can_refuse", by: request.byName, refuseBy: refuseBy!.toISOString() } : { state: "hidden" };
  if (viewer.role !== "admin") return { state: "hidden" };
  // A request waits 7 days even if the owner visits, but taking over needs the owner still away then (audit N4).
  if (request) {
    if (request.by !== viewer.id) return { state: "asked_by_other", by: request.byName };
    if (refuseBy!.getTime() > now.getTime()) return { state: "waiting", refuseBy: refuseBy!.toISOString() };
    return ownerAway(input.ownerLastActiveHere, now, input.since) ? { state: "ready" } : { state: "hidden" };
  }
  return ownerAway(input.ownerLastActiveHere, now, input.since) ? { state: "can_ask" } : { state: "hidden" };
}

/** The request is older than REQUEST_DAYS. */
export function requestExpired(at: Date, now: Date = new Date()) {
  return at.getTime() + REQUEST_DAYS * DAY_MS <= now.getTime();
}
