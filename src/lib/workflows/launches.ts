import { liveBlockLine } from "@/lib/workspaces/doc-live-blocks";

/**
 * Report 38.10 D2 (plan A3.1): Launch checklists. A launch is a document in the Launches section (F2) with a date, a
 * stage and one task-rows block per checklist stage; its steps are real tasks. Presets are data here (call 3): each
 * stage becomes a heading and a block whose key is fixed, so the steps land in the right block.
 */
export const LAUNCH_STAGES = ["planning", "getting_ready", "launched", "closed", "cancelled"] as const;
export type LaunchStage = (typeof LAUNCH_STAGES)[number];
export const LAUNCH_STAGE_LABEL: Record<LaunchStage, string> = { planning: "Planning", getting_ready: "Getting ready", launched: "Launched", closed: "Closed", cancelled: "Canceled" };

export type LaunchPreset = { id: string; name: string; stages: Array<{ name: string; steps: string[] }> };
/** A3.1 ships Blank; A3.2–A3.8 add the other presets, one unit each. */
export const LAUNCH_PRESETS: LaunchPreset[] = [
  { id: "blank", name: "Blank", stages: [{ name: "Checklist", steps: [] }] },
];
export const launchPreset = (id: string) => LAUNCH_PRESETS.find((p) => p.id === id) ?? null;

/** A stage's block key, fixed by its place in the preset (a launch's blocks are made once, from its preset). */
export const stageBlockKey = (index: number) => `launch${index + 1}`;

/** W1: the new launch document: the name, then one heading and one task-rows block per stage, then What's new. */
export function launchMarkdown(preset: LaunchPreset, name: string) {
  const stages = preset.stages.map((s, i) => `## ${s.name}\n\n${liveBlockLine("task_rows", stageBlockKey(i), s.name)}\n`);
  return `# ${name}\n\n${stages.join("\n")}\n## What’s new\n\n### Added\n\n### Improved\n\n### Fixed\n`;
}

/** S1: "14 of 31 steps", canceled steps not counted; none at all says so. */
export function launchProgress(steps: Array<{ status: string; stage?: string | null }>) {
  const counted = steps.filter((s) => s.stage !== "cancelled");
  const done = counted.filter((s) => s.status === "done").length;
  return { done, total: counted.length, text: counted.length ? `${done} of ${counted.length} steps` : "No steps" };
}

/** W2: the first step leaving To do moves Planning to Getting ready; nothing else moves by itself. */
export const stageAfterStepStarted = (stage: LaunchStage | undefined) => (!stage || stage === "planning" ? "getting_ready" as const : null);

/** S1 countdown: "in 23 days", "today", "3 days ago", or "Launched Dec 12". */
export function countdown(date: string, today: string, launchedAt?: string | null) {
  if (launchedAt) return `Launched ${new Date(launchedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days === 0 ? "today" : days > 0 ? `in ${days} ${days === 1 ? "day" : "days"}` : `${-days} ${days === -1 ? "day" : "days"} ago`;
}

/** W4: What's new from what ships (Feature → Added, Improvement → Improved) and bugs Fixed in this version (call 5). */
export function whatsNew(items: Array<{ title: string; itemType?: string | null }>, bugs: Array<{ title: string; fixedIn?: string | null }>, versionLabel: string | null) {
  const v = versionLabel?.trim().toLowerCase();
  return {
    added: items.filter((i) => (i.itemType ?? "feature") === "feature").map((i) => i.title),
    improved: items.filter((i) => i.itemType === "improvement").map((i) => i.title),
    fixed: [...items.filter((i) => i.itemType === "fix").map((i) => i.title), ...(v ? bugs.filter((b) => b.fixedIn?.trim().toLowerCase() === v).map((b) => b.title) : [])],
  };
}

/** W7: steps' due dates moved with the launch; undated steps stay undated. */
export function shiftDates<T extends { dueDate: string | null }>(steps: T[], days: number) {
  return steps.map((s) => ({ ...s, dueDate: s.dueDate ? new Date(Date.parse(`${s.dueDate.slice(0, 10)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10) : null }));
}

/** W6 and call 6: Close is suggested 14 days after launching; nothing closes by itself. */
export const closeSuggested = (launchedAt: string | null | undefined, now: Date) => Boolean(launchedAt) && now.getTime() - Date.parse(launchedAt!) >= 14 * 86_400_000;
