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
