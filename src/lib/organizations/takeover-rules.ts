import { LAST_ACTIVE_HERE_SINCE } from "@/lib/organizations/member-rules";

// Ask to take over (report §45.2, decision 170): pure, so Settings and the server agree. No scheduled job: the
// 30 days away and the 7 days to refuse are checked when Settings opens.

export const OWNER_AWAY_DAYS = 30;
export const REFUSE_DAYS = 7;
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
  request: { by: string; byName: string; at: Date } | null;
  now?: Date;
  since?: Date;
}): TakeoverState {
  const now = input.now ?? new Date();
  const { request, viewer } = input;
  const refuseBy = request ? new Date(request.at.getTime() + REFUSE_DAYS * DAY_MS) : null;
  if (viewer.role === "owner") return request ? { state: "owner_can_refuse", by: request.byName, refuseBy: refuseBy!.toISOString() } : { state: "hidden" };
  if (viewer.role !== "admin") return { state: "hidden" };
  // A request stays until refused or 7 days pass, even if the owner comes back (a quick visit doesn't cancel it).
  if (request) {
    if (request.by !== viewer.id) return { state: "asked_by_other", by: request.byName };
    return refuseBy!.getTime() <= now.getTime() ? { state: "ready" } : { state: "waiting", refuseBy: refuseBy!.toISOString() };
  }
  return ownerAway(input.ownerLastActiveHere, now, input.since) ? { state: "can_ask" } : { state: "hidden" };
}
