import { z } from "zod";

import { WORKFLOW_CATALOG } from "@/lib/workflows/catalog";
import { isOnBoard } from "@/lib/workflows/rules";
import { WORKFLOW_TYPES, workflowType } from "@/lib/workflows/types";

/**
 * Report 38.4 F3 part 7: the New module's rules. One dialog makes every type; these say which tabs it shows, where a
 * new item may start, and the footer line that says where it will show.
 */
const TYPE_ORDER = ["task", "bug", "request", "content", "project", "roadmap_item"];

/** The item types the added workflows bring, in the fixed order (28.11), only those the registry defines. */
export function addedTypes(addedWorkflows: string[]) {
  const types = WORKFLOW_CATALOG.filter((w) => addedWorkflows.includes(w.id)).flatMap((w) => w.types);
  return TYPE_ORDER.filter((t) => t !== "task" && types.includes(t) && WORKFLOW_TYPES[t]);
}

/** "What are you creating?" tabs: Task, the added types, then Assignment in an organization. */
export function moduleTabs(types: string[], opts: { assignment?: boolean } = {}) {
  return ["task", ...TYPE_ORDER.filter((t) => t !== "task" && types.includes(t)), ...(opts.assignment ? ["assignment"] : [])];
}

/** Where a new item may start: its stages up to the one where it joins the board (a bug: New, Confirmed, Fixing). */
export function startingStages(type: string) {
  const t = workflowType(type);
  if (!t.stages.length) return [];
  // A type never on the board (a project) starts at any stage before Paused and the closing ones.
  if (!t.joinStage) return t.stages.filter((s) => !s.closing && s.key !== "paused");
  const join = t.stages.findIndex((s) => s.key === t.joinStage);
  return t.stages.slice(0, join + 1).filter((s) => !s.closing);
}

const ownTabName = (type: string) => WORKFLOW_CATALOG.find((w) => w.types.includes(type) && w.tab)?.name ?? `${workflowType(type).label}s`;

/** The footer's one muted line (S2): where the item will show once created. Null for a plain task, as today. */
export function footerLine(type: string, stage: string | null, sprintAllowed: boolean) {
  if (type === "task" || !stage) return null;
  const tab = ownTabName(type);
  if (!workflowType(type).joinStage) return `Shows in ${tab}`;
  if (!isOnBoard(type, stage)) return `Shows in ${tab} · not on the Tasks board yet`;
  const label = workflowType(type).stages.find((s) => s.key === stage)!.label;
  return `Joins Tasks at ${label} · also shows in ${tab}${sprintAllowed ? "" : " · Goes to the Backlog"}`;
}

/** Labels and sections a type changes (28.11): Request's due is Need by, Content's is Publish date. */
export function sectionsFor(type: string) {
  // A project has a start and an end (38.5 part 5).
  return { dueLabel: type === "request" ? "Need by" : type === "content" ? "Publish date" : type === "project" ? "End date" : "Due date", startDate: type === "project" };
}

/** A sprint only means something for an item on the board. */
export const sprintApplies = (type: string, stage: string | null) => type === "task" || isOnBoard(type, stage);

/** Each type's own fields (its round writes them; none yet), checked the same way in the module and on the server. */
const TYPE_FIELDS: Record<string, z.ZodType<Record<string, unknown>>> = {};
export const typeFieldsSchema = (type: string) => TYPE_FIELDS[type] ?? z.object({}).strict();
