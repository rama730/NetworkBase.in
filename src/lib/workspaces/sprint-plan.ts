// Sprint redesign (docs/superpowers/plans/2026-11-04-sprint-redesign.md): a sprint is a stretch of time with one goal;
// work is planned into it, it runs, and when it ends it's closed. The rules behind the page, in one place.
import type { SprintHealthSummary } from "@/lib/workspaces/sprint-detail";

type SprintLike = { id: string; status: string; startDate: string | null; endDate: string | null };
export type SprintPhase = "upcoming" | "running" | "ended" | "closed" | "canceled" | "archived";

export const PHASE_WORDS: Record<SprintPhase, { label: string; status: string }> = {
  upcoming: { label: "Upcoming", status: "active" },
  running: { label: "Running", status: "completed" },
  ended: { label: "Ended", status: "draft" },
  closed: { label: "Closed", status: "archived" },
  canceled: { label: "Canceled", status: "blocked" },
  archived: { label: "Archived", status: "archived" },
};

const DAY = 86_400_000;
const dateOnly = (value: string) => value.slice(0, 10);
const dayNumber = (value: string) => Date.parse(`${dateOnly(value)}T00:00:00Z`) / DAY;
const today = (now: Date) => now.toISOString().slice(0, 10);

export function sprintPhase(sprint: Pick<SprintLike, "status" | "endDate">, now = new Date()): SprintPhase {
  if (sprint.status === "planning") return "upcoming";
  if (sprint.status === "completed") return "closed";
  if (sprint.status === "cancelled") return "canceled";
  if (sprint.status === "archived") return "archived";
  // Close-out is deliberate (it moves work), so a running sprint past its last day waits as Ended.
  return sprint.endDate && dateOnly(sprint.endDate) < today(now) ? "ended" : "running";
}

/** Day N of M (its last day counts), how far through it is, and days left. */
export function sprintTime(sprint: Pick<SprintLike, "startDate" | "endDate">, now = new Date()) {
  if (!sprint.startDate || !sprint.endDate) return null;
  const days = Math.max(1, dayNumber(sprint.endDate) - dayNumber(sprint.startDate) + 1);
  const day = Math.min(days, Math.max(0, dayNumber(today(now)) - dayNumber(sprint.startDate) + 1));
  return { day, days, percent: Math.round((day / days) * 100), daysLeft: day === 0 ? days : Math.max(0, days - day) };
}

/** Work done against time passed: ahead by 10 points or more, behind by more than 15. */
export function sprintPace(timePercent: number, workPercent: number): "ahead" | "on track" | "behind" {
  if (workPercent - timePercent >= 10) return "ahead";
  if (timePercent - workPercent > 15) return "behind";
  return "on track";
}

/** Points when the team uses them, otherwise tasks. */
export function workProgress(summary: Pick<SprintHealthSummary, "totalTasks" | "completedTasks" | "totalStoryPoints" | "completedStoryPoints">) {
  const points = summary.totalStoryPoints > 0;
  const done = points ? summary.completedStoryPoints : summary.completedTasks;
  const total = points ? summary.totalStoryPoints : summary.totalTasks;
  return { done, total, unit: points ? ("points" as const) : ("tasks" as const), percent: total ? Math.round((done / total) * 100) : 0 };
}

export type RailItem<T> = { type: "sprint"; sprint: T } | { type: "gap"; from: string; to: string };
export type RailGroup<T> = { key: "now" | "next" | "later" | "past"; title: string; items: RailItem<T>[] };

/** §5.1: Now (running or ended), Next, Later, Past (newest first), with the gaps between planned sprints. */
export function termRail<T extends SprintLike>(sprints: T[], now = new Date()): RailGroup<T>[] {
  const byStart = (a: T, b: T) => (a.startDate ?? "").localeCompare(b.startDate ?? "");
  const current = sprints.filter((x) => ["running", "ended"].includes(sprintPhase(x, now))).sort(byStart);
  const upcoming = sprints.filter((x) => sprintPhase(x, now) === "upcoming").sort(byStart);
  const past = sprints.filter((x) => ["closed", "canceled", "archived"].includes(sprintPhase(x, now)))
    .sort((a, b) => (b.endDate ?? b.startDate ?? "").localeCompare(a.endDate ?? a.startDate ?? ""));
  const groups: RailGroup<T>[] = [{ key: "now", title: "Now", items: [] }, { key: "next", title: "Next", items: [] }, { key: "later", title: "Later", items: [] }, { key: "past", title: "Past", items: [] }];
  let previous: T | null = null;
  [...current, ...upcoming].forEach((sprint) => {
    const group = current.includes(sprint) ? groups[0]! : sprint === upcoming[0] ? groups[1]! : groups[2]!;
    if (previous?.endDate && sprint.startDate && dayNumber(sprint.startDate) - dayNumber(previous.endDate) > 1) {
      const iso = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
      group.items.push({ type: "gap", from: iso(dayNumber(previous.endDate) + 1), to: iso(dayNumber(sprint.startDate) - 1) });
    }
    group.items.push({ type: "sprint", sprint });
    if (sprint.endDate) previous = sprint;
  });
  groups[3]!.items = past.map((sprint) => ({ type: "sprint" as const, sprint }));
  return groups.filter((g) => g.items.length);
}

/** Board/review report §6: "week 3 of 6" for a CO (or the CO around a sprint), counted from its first day. */
export function weekOf(main: Pick<SprintLike, "startDate" | "endDate">, now = new Date()) {
  const time = sprintTime(main, now);
  return time && time.day > 0 ? `week ${Math.ceil(time.day / 7)} of ${Math.ceil(time.days / 7)}` : null;
}

/** The sprints inside a CO by start date, with the days nobody planned between them (cancelled ones don't count). */
export function withGaps<T extends { startDate: string | null; endDate: string | null; status: string }>(sprints: T[]): RailItem<T>[] {
  const items: RailItem<T>[] = [];
  let lastEnd: string | null = null;
  for (const sprint of [...sprints].sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))) {
    const counts = sprint.status !== "cancelled";
    if (counts && lastEnd && sprint.startDate && dayNumber(sprint.startDate) - dayNumber(lastEnd) > 1) {
      const iso = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
      items.push({ type: "gap", from: iso(dayNumber(lastEnd) + 1), to: iso(dayNumber(sprint.startDate) - 1) });
    }
    items.push({ type: "sprint", sprint });
    if (counts && sprint.endDate) lastEnd = sprint.endDate;
  }
  return items;
}

type WorkLike = { id: string; status: string; reviewStatus?: string | null; membershipState: string; isDeleted: boolean; assignee: { id: string; fullName: string | null } | null };
const STATE_ORDER: Array<[string, string]> = [["in_progress", "In progress"], ["blocked", "Blocked"], ["review", "In review"], ["todo", "To do"], ["done", "Done"]];
const stateOf = (t: WorkLike) => (t.reviewStatus === "pending" ? "review" : t.status);

/** §5.4, §8.5: the sprint's work by state or by person, Mine when given the viewer; removed work apart. */
export function workGroups<T extends WorkLike>(tasks: T[], by: "state" | "person", mine?: string | null) {
  const live = tasks.filter((t) => !t.isDeleted && t.membershipState !== "historical" && (!mine || t.assignee?.id === mine));
  const removed = tasks.filter((t) => t.isDeleted || t.membershipState === "historical");
  if (by === "state") {
    return { removed, groups: STATE_ORDER.map(([key, title]) => ({ key, title, tasks: live.filter((t) => stateOf(t) === key) })).filter((g) => g.tasks.length) };
  }
  const names = [...new Map(live.filter((t) => t.assignee).map((t) => [t.assignee!.id, t.assignee!.fullName ?? "Someone"])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const groups = names.map(([id, title]) => ({ key: id, title, tasks: live.filter((t) => t.assignee?.id === id) }));
  const nobody = live.filter((t) => !t.assignee);
  return { removed, groups: nobody.length ? [...groups, { key: "nobody", title: "Nobody yet", tasks: nobody }] : groups };
}

/** Whole days until an upcoming sprint's first day (0 on the day). */
export function startsIn(sprint: Pick<SprintLike, "startDate">, now = new Date()) {
  return sprint.startDate ? Math.max(0, dayNumber(sprint.startDate) - dayNumber(today(now))) : null;
}

/** §6.2: the sprints either side of new dates (upcoming and running only), any overlap, and one line saying how it fits. */
export function termStrip(range: { startDate: string; endDate: string }, existing: Array<SprintLike & { name: string }>, skipId?: string | null) {
  const live = existing.filter((x) => x.id !== skipId && x.startDate && x.endDate && (x.status === "planning" || x.status === "active"));
  const start = dateOnly(range.startDate), end = dateOnly(range.endDate);
  const clash = live.find((x) => dateOnly(x.startDate!) <= end && dateOnly(x.endDate!) >= start) ?? null;
  const before = live.filter((x) => dateOnly(x.endDate!) < start).sort((a, b) => b.endDate!.localeCompare(a.endDate!))[0] ?? null;
  const after = live.filter((x) => dateOnly(x.startDate!) > end).sort((a, b) => a.startDate!.localeCompare(b.startDate!))[0] ?? null;
  const gap = before ? dayNumber(start) - dayNumber(before.endDate!) - 1 : null;
  const line = clash ? `Overlaps ${clash.name}.`
    : before && gap === 0 ? `Starts right after ${before.name}. No overlap.`
      : before ? `Starts ${gap} ${gap === 1 ? "day" : "days"} after ${before.name}.`
        : after ? `Ends before ${after.name}.` : "No other sprint around these dates.";
  return { before: before?.name ?? null, after: after?.name ?? null, clash: clash?.name ?? null, line };
}

type Nestable = { id: string; name: string; status: string; parentSprintId?: string | null; startDate?: string | Date | null };

/** Board/review report §6: "CO1 · Week 3–4" for a sprint inside a main sprint of the same list; otherwise its name. */
export function sprintPath(sprint: Nestable, all: Nestable[]) {
  const main = sprint.parentSprintId ? all.find((s) => s.id === sprint.parentSprintId) : null;
  return main ? `${main.name} · ${sprint.name}` : sprint.name;
}

/** The running sprint to name: the sprint inside when a main sprint and one inside it both run. */
export function runningSprint<T extends Nestable>(all: T[]): T | null {
  const running = all.filter((s) => s.status === "active");
  return running.find((s) => s.parentSprintId && all.some((m) => m.id === s.parentSprintId)) ?? running[0] ?? null;
}

/** Main sprints (and sprints whose parent isn't in this list) at the top; each main sprint's sprints by start date. */
export function nestTerm<T extends Nestable>(all: T[]) {
  const ids = new Set(all.map((s) => s.id));
  const top = all.filter((s) => !s.parentSprintId || !ids.has(s.parentSprintId));
  const inside = new Map<string, T[]>();
  for (const s of all) if (s.parentSprintId && ids.has(s.parentSprintId)) inside.set(s.parentSprintId, [...(inside.get(s.parentSprintId) ?? []), s]);
  const at = (s: Nestable) => (s.startDate instanceof Date ? s.startDate.toISOString() : s.startDate ?? "");
  for (const list of inside.values()) list.sort((a, b) => at(a).localeCompare(at(b)));
  return { top, inside };
}
