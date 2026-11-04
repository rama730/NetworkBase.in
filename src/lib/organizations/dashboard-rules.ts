// Org Dashboard, About and Projects rules (report §22, §27, §28), pure so server and screens agree.

const DAY = 86_400_000;

/** Needs attention (report §28.3), with the reasons shown on the row. */
export function needsAttention(input: {
  overdue: number;
  lastActivityAt: Date | null;
  groupCopyState: string | null;
  leadInOrg: boolean;
  status?: string | null;
  now?: Date;
}): string[] {
  if (input.status === "archived") return [];
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  if (input.overdue >= 3) reasons.push(`${input.overdue} overdue`);
  if (!input.lastActivityAt || now.getTime() - input.lastActivityAt.getTime() > 7 * DAY) reasons.push("quiet 7 days");
  if (input.groupCopyState === "missing") reasons.push("group assignment missing");
  if (input.groupCopyState === "returned") reasons.push("group assignment returned");
  if (!input.leadInOrg) reasons.push("lead left the organization");
  return reasons;
}

export type SprintStop = { name: string; status: string; startDate: Date; endDate: Date; completedAt: Date | null };

/**
 * The org Journey is its sprints (report §22.1): done stops carry their completion date, the active sprint is
 * current, otherwise the next planned one; after the last sprint every stop is done.
 */
export function journeyFromSprints(sprints: SprintStop[]) {
  const ordered = [...sprints].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const active = ordered.findIndex((s) => s.status === "active");
  const nextPlanned = ordered.findIndex((s) => s.status !== "completed");
  const currentIndex = active >= 0 ? active : nextPlanned >= 0 ? nextPlanned : ordered.length;
  const completionDates: Record<string, string> = {};
  ordered.forEach((s, i) => {
    if (i < currentIndex && s.completedAt) completionDates[String(i)] = s.completedAt.toISOString();
  });
  return { stages: ordered.map((s) => s.name), currentIndex, completionDates };
}

export type ActivityKind = "sprint" | "project" | "joins" | "announcement" | "doc" | "file" | "assignment" | "submission";

/**
 * Activity privacy (report §27.2): admins see everything; members and guests see org-level events and their
 * own, never other people's submissions or status. About shows only the public-safe kinds (§22.2).
 */
export function activityVisible(event: { kind: ActivityKind; actorId: string | null; public?: boolean }, viewer: { isAdmin: boolean; userId: string | null; publicOnly?: boolean }) {
  if (viewer.publicOnly) return ["sprint", "project", "joins"].includes(event.kind) || (event.kind === "announcement" && event.public === true);
  if (viewer.isAdmin) return true;
  if (event.kind === "submission") return Boolean(viewer.userId) && event.actorId === viewer.userId;
  return true;
}

/**
 * Get started (report §7.2, decision 7): three action cards for admins, only while nothing real exists. Starter
 * folders aren't uploaded files. Nothing is stored; once anything real exists it's gone, and it returns if all of
 * it is deleted.
 */
export function getStartedCards(state: { members: number; sprints: number; tasks: number; workspaces: number; announcements: number; documents: number; files: number }) {
  const empty = state.members <= 1 && state.sprints === 0 && state.tasks === 0 && state.workspaces === 0 && state.announcements === 0 && state.documents === 0 && state.files === 0;
  return empty ? (["invite", "sprint", "workspace"] as const).slice() : [];
}

function zoneDay(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
const dayNumber = (isoDay: string) => Math.round(Date.parse(`${isoDay}T00:00:00Z`) / 86_400_000);
const safeZone = (timeZone?: string | null) => { try { if (timeZone) { new Intl.DateTimeFormat("en", { timeZone }); return timeZone; } } catch { /* UTC */ } return "UTC"; };

/** This week (report §33.5, parity bug 7): calendar days in the organization's zone, not 168 hours. */
export function weekGroup(date: Date, now: Date, timeZone?: string | null): "Today" | "Tomorrow" | "This week" | null {
  const zone = safeZone(timeZone);
  const days = dayNumber(zoneDay(date, zone)) - dayNumber(zoneDay(now, zone));
  if (days < 0 || days > 7 || date.getTime() < now.getTime() - 86_400_000) return null;
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : "This week";
}

/** "Week 6 of 16" (report §33.5): from the term, in the organization's zone; nothing without a term or outside it. */
export function weekLine(termStart: string | null | undefined, termEnd: string | null | undefined, now: Date, timeZone?: string | null) {
  if (!termStart || !termEnd) return null;
  const today = dayNumber(zoneDay(now, safeZone(timeZone)));
  const start = dayNumber(termStart), end = dayNumber(termEnd);
  if (today < start || today > end) return null;
  return `Week ${Math.floor((today - start) / 7) + 1} of ${Math.ceil((end - start + 1) / 7)}`;
}

/** How the class is doing (report §33.5, decision 81): behind first; inactive counts only people not already behind. */
export function classStanding(people: Array<{ behind: boolean; inactive: boolean }>) {
  const behind = people.filter((p) => p.behind).length;
  const inactive = people.filter((p) => !p.behind && p.inactive).length;
  return { onTrack: people.length - behind - inactive, behind, inactive };
}

/** `title`/`detail` are the bold and quiet lines (live-fix 12); `approveId` approves one join request in place. */
export type TodayRow = { kind: string; label: string; href: string; tone?: "amber"; title?: string; detail?: string; approveId?: string; confirmChildId?: string };

/**
 * An assignment's review row (report §33.7 "Nobody reviews for a week"): once the oldest submission has waited a
 * week the row turns amber and says so, "12 waiting, oldest 7 days".
 */
export function reviewRow(title: string, waiting: number, oldest: Date | null, now: Date): { label: string; tone?: "amber" } {
  const days = oldest ? Math.floor((now.getTime() - oldest.getTime()) / DAY) : 0;
  if (days >= 7) return { label: `${waiting} waiting, oldest ${days} days · ${title}`, tone: "amber" };
  return { label: `${waiting} ${waiting === 1 ? "submission" : "submissions"} to review · ${title}` };
}

/**
 * Today (report §33.5, decision 80): what needs an admin now, most urgent first: deadlines today, sprints ending
 * within 2 days, the Education term-end prompt, then the attention rows. The screen shows 5 and "Show N more".
 */
export function todayRows(input: {
  dueToday: Array<{ title: string; handedIn: number; total: number; href: string }>;
  sprintsEnding: Array<{ name: string; endDate: Date; behind: number; href: string }>;
  termEnd: { date: string; ended?: boolean; href: string } | null;
  attention: TodayRow[];
}, now: Date, timeZone?: string | null): TodayRow[] {
  const zone = safeZone(timeZone);
  const weekday = (d: Date) => new Intl.DateTimeFormat("en", { timeZone: zone, weekday: "short" }).format(d);
  const termDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00Z`));
  return [
    ...input.dueToday.map((d) => ({ kind: "due_today", label: `${d.title} due today · ${d.handedIn} of ${d.total} in`, href: d.href })),
    ...input.sprintsEnding.map((s) => ({ kind: "sprint_ending", label: `${s.name} ends ${weekGroup(s.endDate, now, zone) === "Today" ? "today" : weekday(s.endDate)}${s.behind ? ` · ${s.behind} behind` : ""}`, href: s.href })),
    ...(input.termEnd ? [{ kind: "term_end", label: `Term ${input.termEnd.ended ? "ended" : "ends"} ${termDay(input.termEnd.date)} · Review open work, verify members, then archive or duplicate`, href: input.termEnd.href }] : []),
    ...input.attention,
  ];
}

/**
 * About's Stages (report §7.3, decision 79, gaps 5 and 6): stages come from sprints. When there are none, admins
 * see a faded timeline that teaches, members a line, visitors nothing. One sprint is a plain stop, never a lone dot.
 */
export function aboutStages(stageCount: number, viewer: "admin" | "member" | "visitor"): "ghost" | "hint" | "single" | "timeline" | null {
  if (stageCount === 0) return viewer === "admin" ? "ghost" : viewer === "member" ? "hint" : null;
  return stageCount === 1 ? "single" : "timeline";
}

/** Mockup task 5: "Good morning, Asha" at the top of Overview; the hour is the organization's local hour. */
export function greetingFor(hour: number, fullName: string | null) {
  const part = hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 17 ? "Good afternoon" : "Good evening";
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}
