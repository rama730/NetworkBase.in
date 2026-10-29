/**
 * Presence rules, shared by server and client. Two layers:
 * availability (automatic, from activity: the Node badge's four states) and
 * status (any emoji + text, set by a person or a project's owners, Slack
 * style). Pure functions only, so they are unit-tested directly.
 */

export const STATUS_VISIBILITIES = ["everyone", "network", "team"] as const;
export type StatusVisibility = (typeof STATUS_VISIBILITIES)[number];

export type Availability = "now" | "today" | "week" | "offline";

export const STATUS_TEXT_MAX = 80;
/** A status can be set at most this far ahead. */
export const STATUS_MAX_DAYS = 90;
/** "Active now" lasts this long after the last live signal (the live key's TTL). */
export const LIVE_TTL_SECONDS = 150;
/** Without the live key (no Redis), recent activity within this window counts as now. */
export const NOW_FALLBACK_MS = 5 * 60_000;

export const STATUS_EMOJI_MAX = 16;

export type PersonStatus = {
  emoji: string | null;
  text: string | null;
  expiresAt: string | null;
  /** When the status was set (for the timer ring); null for old rows. */
  setAt: string | null;
  pausesNotifications: boolean;
};

export type PersonPresence = {
  userId: string;
  live: boolean;
  lastActiveAt: string | null;
  status: PersonStatus | null;
  /**
   * Realtime will let the viewer join this person's `presence:user:<id>` room (the same SQL rule as the
   * Realtime policy). Badges subscribe only then: a refused private join takes seconds to answer and the
   * socket answers joins in order, so refused rooms stall the viewer's own presence and chat joins.
   */
  realtime: boolean;
};

export type WorkspaceStatus = {
  emoji: string | null;
  text: string | null;
  expiresAt: string | null;
};

export type ClearAfter = "never" | "30m" | "1h" | "4h" | "today" | "week" | "custom";

export type StatusSuggestion = { emoji: string; text: string; clearAfter: ClearAfter; pauses: boolean };

/** One-tap suggestions in the picker (any emoji + text can be typed instead). */
export const STATUS_SUGGESTIONS: StatusSuggestion[] = [
  { emoji: "📅", text: "In a meeting", clearAfter: "1h", pauses: false },
  { emoji: "🚌", text: "Commuting", clearAfter: "30m", pauses: false },
  { emoji: "🤒", text: "Out sick", clearAfter: "today", pauses: true },
  { emoji: "🌴", text: "On vacation", clearAfter: "custom", pauses: true },
  { emoji: "🏡", text: "Working remotely", clearAfter: "today", pauses: false },
];

export const WORKSPACE_STATUS_SUGGESTIONS: StatusSuggestion[] = [
  { emoji: "🏃", text: "In a sprint", clearAfter: "week", pauses: false },
  { emoji: "🚀", text: "Launching", clearAfter: "custom", pauses: false },
  { emoji: "🙋", text: "Hiring", clearAfter: "never", pauses: false },
  { emoji: "⏸️", text: "On hold", clearAfter: "never", pauses: false },
  { emoji: "🏖️", text: "On a break", clearAfter: "custom", pauses: false },
];

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** A short string that contains an emoji (flags, skin tones and ZWJ sequences included). */
export function isStatusEmoji(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= STATUS_EMOJI_MAX && EMOJI.test(value) && !/\s|[<>]/.test(value);
}

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Availability in the viewer's own time zone ("today" means the viewer's today). */
export function availabilityOf(input: { live: boolean; lastActiveAt: string | Date | null }, now: Date = new Date()): Availability {
  if (input.live) return "now";
  if (!input.lastActiveAt) return "offline";
  const at = new Date(input.lastActiveAt);
  const time = at.getTime();
  if (Number.isNaN(time)) return "offline";
  if (sameLocalDay(at, now)) return "today";
  if (now.getTime() - time <= 7 * 24 * 60 * 60_000) return "week";
  return "offline";
}

/**
 * Live = realtime when it has an answer (true or false), else the server's live key.
 * Realtime is the fast signal both ways: a closed tab drops to not-live at once
 * instead of waiting out the key's TTL.
 */
export function resolveLive(realtime: boolean | undefined, server: boolean | undefined) {
  return typeof realtime === "boolean" ? realtime : Boolean(server);
}

export function availabilityLabel(availability: Availability, lastActiveAt?: string | Date | null, now: Date = new Date()) {
  if (availability === "now") return "Active now";
  if (availability === "today") {
    // ponytail: last_active_at is written at most every 5 min, so minutes are coarse to 5.
    const minutes = lastActiveAt ? Math.floor((now.getTime() - new Date(lastActiveAt).getTime()) / 60_000) : NaN;
    if (!Number.isFinite(minutes)) return "Active today";
    if (minutes < 5) return "Active just now";
    if (minutes < 60) return `Active ${minutes}m ago`;
    return `Active ${Math.floor(minutes / 60)}h ago`;
  }
  if (availability === "offline") return "Offline";
  if (lastActiveAt) {
    const days = Math.floor((now.getTime() - new Date(lastActiveAt).getTime()) / (24 * 60 * 60_000));
    if (days >= 1) return `Active ${days}d ago`;
  }
  return "Active this week";
}

const AVAILABILITY_RANK: Record<Availability, number> = { offline: 0, week: 1, today: 2, now: 3 };

/** Degrees the badge's rings turn for a change: a full turn clockwise up in activity, counter-clockwise down. */
export function spinDelta(prev: Availability, next: Availability): 0 | 360 | -360 {
  const change = AVAILABILITY_RANK[next] - AVAILABILITY_RANK[prev];
  return change > 0 ? 360 : change < 0 ? -360 : 0;
}

export type BadgeSpin = {
  availability: Availability;
  /** The availability before the last change: the arcs fade from this hue. */
  from: Availability;
  armed: boolean;
  angle: number;
  /** Counts full change cycles (shrink, spin, grow); it restarts the CSS animations. */
  cycle: number;
  /** Counts "became Active now" halos. */
  halo: number;
  /** Direction of the last full cycle: 1 up in activity, -1 down. */
  dir: 1 | -1;
};

export function initialBadgeSpin(availability: Availability, armed: boolean): BadgeSpin {
  return { availability, from: availability, armed, angle: 0, cycle: 0, halo: 0, dir: 1 };
}

/**
 * The badge's spin state for a new availability. A change runs the full cycle only
 * when it was seen while data was already loaded (`armed`) and the badge won the
 * animation budget (`full`); otherwise the hue and weight just fade. The first
 * render and the change that arrives with the first data are the baseline.
 */
export function advanceBadgeSpin(state: BadgeSpin, availability: Availability, animate: boolean, full = true): BadgeSpin {
  const changed = state.availability !== availability;
  if (!changed && state.armed === animate) return state;
  const spins = changed && state.armed && animate && full;
  const delta = changed ? spinDelta(state.availability, availability) : 0;
  return {
    availability,
    from: changed ? state.availability : state.from,
    armed: animate,
    angle: spins ? state.angle + delta : state.angle,
    cycle: spins ? state.cycle + 1 : state.cycle,
    halo: spins && availability === "now" ? state.halo + 1 : state.halo,
    dir: spins ? (delta > 0 ? 1 : -1) : state.dir,
  };
}

/** While presence data loads: a static placeholder for this long, then the loader (gray arcs that spin). */
export const LOADING_SHOW_AFTER_MS = 200;
/** Once shown, the loader stays at least this long so it never flickers. */
export const LOADING_MIN_MS = 600;
/** Data that has not arrived by now stops the loader: the badge shows what it has. */
export const LOADING_GIVE_UP_MS = 8000;

/**
 * What the badge does when its data arrives: fade straight from the placeholder when
 * the loader never showed, else keep the loader up to its minimum time, then settle.
 */
export function loadingSettlePlan(shownAt: number | null, arrivedAt: number): { mode: "fade" | "settle"; delay: number } {
  if (shownAt === null) return { mode: "fade", delay: 0 };
  return { mode: "settle", delay: Math.max(0, LOADING_MIN_MS - (arrivedAt - shownAt)) };
}

/** React Query retry rule for presence: a refused request (not signed in) will not change by retrying, a flaky one gets one retry. */
export function retryPresence(failureCount: number, error: unknown) {
  if (error instanceof Error && error.message === "unauthorized") return false;
  return failureCount < 1;
}

/** Ring `index` (0 inner to 3 outer) in the change wave: inner first going up, outer first going down. */
export function ringOrder(index: number, direction: 1 | -1) {
  return direction > 0 ? index : 3 - index;
}

const RING_WEIGHT: Record<Availability, number> = { now: 1, today: 0.88, week: 0.74, offline: 0.6 };

/** Ring thickness by availability: thinner as activity drops, a cue that does not rely on color. */
export function ringWeight(availability: Availability) {
  return RING_WEIGHT[availability];
}

/** The status emoji shows inside the rings only on badges at least this big (px). */
export const STATUS_EMOJI_MIN_SIZE = 20;

export function showStatusEmoji(emoji: string | null | undefined, size: number): emoji is string {
  return Boolean(emoji?.trim()) && size >= STATUS_EMOJI_MIN_SIZE;
}

/** A status emoji grows the badge to `statusSize` so the emoji fits; the badge never shrinks. */
export function statusBadgeSize(size: number, statusSize: number | undefined, emoji: string | null | undefined) {
  return emoji?.trim() && statusSize ? Math.max(size, statusSize) : size;
}

/** Share of a timed status still to run (1 just set, 0 ended); null without a start and an end. */
export function statusTimerFraction(setAt: string | null | undefined, expiresAt: string | null | undefined, now: number = Date.now()) {
  if (!setAt || !expiresAt) return null;
  const start = Date.parse(setAt);
  const end = Date.parse(expiresAt);
  if (!(end > start)) return null;
  return Math.min(1, Math.max(0, (end - now) / (end - start)));
}

/** A status whose end time has passed is treated as cleared. */
export function activeStatus<T extends { expiresAt: string | null }>(status: T | null, now: Date = new Date()): T | null {
  if (!status) return null;
  if (status.expiresAt && new Date(status.expiresAt).getTime() <= now.getTime()) return null;
  return status;
}

function endOfDay(now: Date) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** "Clear after" choice → end time (local), or null for "never". */
export function clearAfterToDate(choice: ClearAfter, now: Date = new Date(), custom?: Date | null): Date | null {
  switch (choice) {
    case "never": return null;
    case "30m": return new Date(now.getTime() + 30 * 60_000);
    case "1h": return new Date(now.getTime() + 60 * 60_000);
    case "4h": return new Date(now.getTime() + 4 * 60 * 60_000);
    case "today": return endOfDay(now);
    case "week": {
      const end = endOfDay(now);
      end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
      return end;
    }
    case "custom": return custom ?? null;
  }
}

/** Server-side check of a requested end time: future, within STATUS_MAX_DAYS. */
export function validStatusExpiry(expiresAt: string | null, now: Date = new Date()): Date | null | "invalid" {
  if (expiresAt === null) return null;
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return "invalid";
  if (at.getTime() <= now.getTime()) return "invalid";
  if (at.getTime() - now.getTime() > STATUS_MAX_DAYS * 24 * 60 * 60_000) return "invalid";
  return at;
}

function untilText(expiresAt: string, now: Date) {
  const at = new Date(expiresAt);
  if (sameLocalDay(at, now)) return `until ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  return `until ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** "In a meeting · until 3:00 PM" (text only; the emoji is drawn beside it). */
export function statusLabel(status: { text: string | null; expiresAt: string | null }, now: Date = new Date()) {
  const base = status.text?.trim() || "";
  if (!status.expiresAt) return base;
  return base ? `${base} · ${untilText(status.expiresAt, now)}` : untilText(status.expiresAt, now);
}

/** Someone who paused notifications won't answer soon: mentions show a heads-up. */
export function isAway(status: PersonStatus | null) {
  return Boolean(status?.pausesNotifications);
}

/** Project activity: the same four steps, from the project's last change. */
export function projectAvailabilityOf(updatedAt: string | Date | null, now: Date = new Date()): Availability {
  if (!updatedAt) return "offline";
  const time = new Date(updatedAt).getTime();
  if (Number.isNaN(time)) return "offline";
  if (now.getTime() - time < NOW_FALLBACK_MS) return "now";
  return availabilityOf({ live: false, lastActiveAt: updatedAt }, now);
}

export type PresencePrivacyInput = {
  self: boolean;
  blocked: boolean;
  viewerShowsActivity: boolean;
  targetShowsActivity: boolean;
  connected: boolean;
  teammate: boolean;
  visibility: StatusVisibility;
};

/**
 * Who sees what (server-side): blocked pairs see nothing; activity needs both
 * sides to share it (hiding is mutual); a status needs its audience — everyone,
 * your network (connections and project teammates), or teammates only. You
 * always see your own.
 */
export function presencePrivacy(input: PresencePrivacyInput): { activity: boolean; status: boolean } {
  if (input.self) return { activity: true, status: true };
  if (input.blocked) return { activity: false, status: false };
  const activity = input.viewerShowsActivity && input.targetShowsActivity;
  const status = input.visibility === "everyone"
    || (input.visibility === "network" && (input.connected || input.teammate))
    || (input.visibility === "team" && input.teammate);
  return { activity, status };
}
