/**
 * Report 38.4 F3 S5, W7 (plan A0.11): the filter chips' state. It lives in the address (`?assignee=me&type=bug`) so a
 * copied link opens the same view; nothing is stored. Unknown keys and values are dropped. The sprint chip is
 * `taskSprint`, because the Sprints tab already reads `?sprint=` to open a sprint.
 */
export type DueFilter = "overdue" | "today" | "week" | "none";
export type TaskFilters = { assignee: string[]; type: string[]; due: DueFilter | null; priority: string[]; sprint: string[] };
export const EMPTY_FILTERS: TaskFilters = { assignee: [], type: [], due: null, priority: [], sprint: [] };

const DUE: DueFilter[] = ["overdue", "today", "week", "none"];
const PRIORITY = ["urgent", "high", "medium", "low"];
const list = (v: string | null, ok: (x: string) => boolean) => [...new Set((v ?? "").split(",").map((x) => x.trim()).filter((x) => x && ok(x)))].slice(0, 20);
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);

export function filtersFromUrl(params: URLSearchParams): TaskFilters {
  const due = params.get("due");
  return {
    assignee: list(params.get("assignee"), (x) => x === "me" || x === "none" || isId(x)),
    type: list(params.get("type"), (x) => /^[a-z_]{1,40}$/.test(x)),
    due: DUE.includes(due as DueFilter) ? (due as DueFilter) : null,
    priority: list(params.get("priority"), (x) => PRIORITY.includes(x)),
    sprint: list(params.get("taskSprint"), (x) => x === "none" || isId(x)),
  };
}

/** The address keys to write; null removes one. */
export function filtersToUrl(f: TaskFilters): Record<string, string | null> {
  const join = (v: string[]) => (v.length ? v.join(",") : null);
  return { assignee: join(f.assignee), type: join(f.type), due: f.due, priority: join(f.priority), taskSprint: join(f.sprint) };
}

/** The address keys the chips use, cleared when leaving Tasks. */
export const TASK_FILTER_KEYS = ["assignee", "type", "due", "priority", "taskSprint"];

export const setCount = (f: TaskFilters) => [f.assignee.length, f.type.length, f.due ? 1 : 0, f.priority.length, f.sprint.length].filter(Boolean).length;

type FilterableTask = { assigneeId?: string | null; itemType?: string; dueDate?: string | null; status?: string; priority?: string; sprintId?: string | null };
const dayKey = (d: Date, tz?: string) => d.toLocaleDateString("en-CA", tz ? { timeZone: tz } : undefined);

/** Does the task pass every set chip? "me" is the viewer; due days are the viewer's calendar days. */
export function matchesFilters(task: FilterableTask, f: TaskFilters, viewerId: string | null, now = new Date(), tz?: string) {
  if (f.assignee.length) {
    const who = task.assigneeId ?? null;
    if (!f.assignee.some((a) => (a === "me" ? who !== null && who === viewerId : a === "none" ? who === null : who === a))) return false;
  }
  if (f.type.length && !f.type.includes(task.itemType ?? "task")) return false;
  if (f.priority.length && !f.priority.includes(task.priority ?? "medium")) return false;
  if (f.sprint.length && !f.sprint.some((s) => (s === "none" ? !task.sprintId : task.sprintId === s))) return false;
  if (f.due) {
    if (f.due === "none") return !task.dueDate;
    if (!task.dueDate) return false;
    // A due date is a calendar day stored at UTC midnight (taskDueDateKey); today is the viewer's own day.
    const due = new Date(task.dueDate).toISOString().slice(0, 10);
    const today = dayKey(now, tz);
    if (f.due === "overdue") return due < today && task.status !== "done";
    if (f.due === "today") return due === today;
    const end = new Date(Date.parse(`${today}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
    return due >= today && due <= end;
  }
  return true;
}

/** "Assigned to: Me +2" — the chip's text once set (S5). */
export const chipValue = (labels: string[]) => (labels.length ? `${labels[0]}${labels.length > 1 ? ` +${labels.length - 1}` : ""}` : null);
