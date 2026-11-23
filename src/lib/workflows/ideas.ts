import { z } from "zod";

import { IDEAS_BLOCK_LINE } from "@/lib/workspaces/doc-live-blocks";

/**
 * Report 38.13 D4 (plan A5.3): ideas. An Ideas document holds a ranked block; each idea (a task of type `idea`, never on
 * the board, never public) scores Impact × Ease × Confidence and moves Idea → Validating → Building → Launched (or
 * Dropped). Start building makes a project, a roadmap item or a task.
 */
export const IDEA_STAGE_WORD: Record<string, string> = { idea: "Idea", validating: "Validating", building: "Building", launched: "Launched", dropped: "Dropped" };
export const DEFAULT_VALIDATION = ["Talk to 5 people", "Landing page", "First sign-up"];

const score15 = z.number().int().min(1).max(5);
export const ideaFieldsSchema = z.object({
  pitch: z.string().trim().max(200).optional(),
  impact: score15.nullish(), ease: score15.nullish(), confidence: score15.nullish(),
  builtAs: z.string().uuid().nullish(),
  droppedReason: z.string().trim().max(500).nullish(),
}).strict();

/** Call 1: the product (1–125), or null while any score is missing. */
export const iceScore = (impact?: number | null, ease?: number | null, confidence?: number | null) =>
  impact && ease && confidence ? impact * ease * confidence : null;

/** S1: highest score first; ties by confidence, then the oldest; unscored at the bottom ("Not scored"); Dropped left out. */
export function rankIdeas<T extends { impact: number | null; ease: number | null; confidence: number | null; createdAt: string; stage: string | null }>(ideas: T[]) {
  const scored = ideas.filter((i) => i.stage !== "dropped").map((i) => ({ ...i, score: iceScore(i.impact, i.ease, i.confidence) }));
  scored.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.confidence ?? 0) - (a.confidence ?? 0) || a.createdAt.localeCompare(b.createdAt));
  let n = 0;
  return scored.map((i) => ({ ...i, rank: i.score == null ? null : ++n }));
}

/** Call 4: what the idea became is finished: a task or project Completed, a roadmap item Launched (not canceled). */
export const launchedFromBuilt = (built: { itemType: string | null; status: string; stage: string | null }) =>
  built.itemType === "roadmap_item" ? built.stage === "launched" : built.status === "done" && built.stage !== "cancelled";

/** Setting it up: the workspace's validation checklist (Settings), else the default. */
export function validationSteps(raw: unknown) {
  const steps = raw && typeof raw === "object" && Array.isArray((raw as { steps?: unknown }).steps)
    ? ((raw as { steps: unknown[] }).steps.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim().slice(0, 100)).slice(0, 10)) : [];
  return steps.length ? steps : DEFAULT_VALIDATION;
}

/** W1: "Ideas": a line on how scoring works and the ranked block. */
export const ideasMarkdown = (title = "Ideas") =>
  `# ${title}\n\n_Score each idea 1–5 for Impact, Ease and Confidence; the highest score ranks first. Validate before you build._\n\n${IDEAS_BLOCK_LINE}\n`;
