import { z } from "zod";

/**
 * Report 38.9 T2 (plan A2.10): Roadmap. A roadmap item is a task with item_type "roadmap_item" that never sits on the
 * board; its work tasks (Part of it) do. The main view is Now · Next · Later, a column field (call 1).
 */
export const COLUMNS = ["now", "next", "later"] as const;
export type Column = (typeof COLUMNS)[number];
export const COLUMN_LABEL: Record<Column, string> = { now: "Now", next: "Next", later: "Later" };
export const ITEM_TYPES = ["feature", "improvement", "fix", "milestone"] as const;
export const ITEM_TYPE_LABEL: Record<(typeof ITEM_TYPES)[number], string> = { feature: "Feature", improvement: "Improvement", fix: "Fix", milestone: "Milestone" };
/** Call 2: a Milestone's name comes from 22.4's game milestones, in order. */
export const MILESTONES = ["Concept", "Prototype", "Vertical slice", "Alpha", "Beta", "Release"] as const;

export const roadmapFieldsSchema = z.object({
  outcome: z.string().trim().max(200).optional(),
  column: z.enum(COLUMNS).nullable().optional(),
  itemType: z.enum(ITEM_TYPES).optional(),
  milestone: z.enum(MILESTONES).nullable().optional(),
  builtBy: z.array(z.string().uuid()).max(20).optional(),
  requestIds: z.array(z.string().uuid()).max(50).optional(),
  wontDoReason: z.string().trim().max(1000).optional(),
}).strict();
export type RoadmapFields = z.infer<typeof roadmapFieldsSchema>;

/**
 * Part 7: progress from completed work tasks and Built by projects, a project counting as its own task count
 * (its completion × its work). Cancelled work is left out. Nothing linked: null (no %).
 */
export function itemProgress(work: Array<{ status: string; stage?: string | null }>, projects: Array<{ percent: number; tasks: number }>) {
  const counted = work.filter((w) => w.stage !== "cancelled");
  const total = counted.length + projects.reduce((n, p) => n + Math.max(1, p.tasks), 0);
  if (!total) return null;
  const done = counted.filter((w) => w.status === "done").length + projects.reduce((n, p) => n + (Math.max(1, p.tasks) * p.percent) / 100, 0);
  return Math.round((100 * done) / total);
}

/** Call 3: the first work task starting moves a Backlog or Planned item to In progress; nothing else moves by itself. */
export function autoStage(stage: string | null, event: "work_started") {
  return event === "work_started" && (stage === "backlog" || stage === "planned") ? "in_progress" : null;
}

/** W3: a card dragged into a column; a Backlog item becomes Planned. */
export const stageAfterColumn = (stage: string | null) => (stage === "backlog" || !stage ? "planned" : null);

/** Part 7: Launched and Won't do leave the column board (the column is kept, so reopening restores it). */
export const onColumnBoard = (stage: string | null) => stage !== "launched" && stage !== "wont_do";

/** Milestones sort in their game order; anything else after them. */
export const milestoneOrder = (name: string | null | undefined) => { const i = MILESTONES.indexOf(name as (typeof MILESTONES)[number]); return i < 0 ? MILESTONES.length : i; };

/** S7 Overview card: "Now: 4 · 1 in testing". */
export function roadmapSummary(items: Array<{ stage: string | null; typeFields: Record<string, unknown> }>) {
  const live = items.filter((i) => onColumnBoard(i.stage));
  return { now: live.filter((i) => i.typeFields.column === "now").length, next: live.filter((i) => i.typeFields.column === "next").length, testing: live.filter((i) => i.stage === "testing").length };
}
