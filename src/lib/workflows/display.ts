import { WORKFLOW_CATALOG } from "@/lib/workflows/catalog";
import { isOnBoard } from "@/lib/workflows/rules";
import { WORKFLOW_TYPES, type TaskStatus } from "@/lib/workflows/types";

/**
 * Report 38.2 F1 S5, S7: how a typed item reads on cards and its page. A plain task shows nothing new.
 */
const STATUS_WORD: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Completed" };
const stageLabel = (type: string, stage: string | null | undefined) => WORKFLOW_TYPES[type]?.stages.find((s) => s.key === stage)?.label ?? null;
export const ownTabOf = (type: string) => WORKFLOW_CATALOG.find((w) => w.types.includes(type) && w.tab) ?? null;
/** Where a type's items list: its own tab, or a view inside Tasks (projects: Projects). */
const placeOf = (type: string) => { const own = ownTabOf(type); return own?.tab ? { tab: own.tab, name: own.name } : type === "project" ? { tab: "projects", name: "Projects" } : null; };

/** S5: "Bug · Fixing", with "· Blocked" while blocked on the board (B2). Null for a plain task. */
export function typeChip(type: string | undefined, stage: string | null | undefined, status: string) {
  const t = type ? WORKFLOW_TYPES[type] : null;
  if (!t || !t.stages.length) return null;
  const parts = [t.label, stageLabel(type!, stage)].filter(Boolean);
  if (status === "blocked") parts.push("Blocked");
  return parts.join(" · ");
}

/** S7: "Shows in: Tasks · In progress / Bugs · Fixing" — Tasks only while the item is on the board. */
export function showsIn(type: string | undefined, stage: string | null | undefined, status: string) {
  const t = type ? WORKFLOW_TYPES[type] : null;
  if (!t || !t.stages.length) return [];
  const own = placeOf(type!);
  return [
    ...(isOnBoard(type!, stage ?? null) ? [{ tab: "tasks", label: `Tasks · ${STATUS_WORD[status as TaskStatus] ?? "To do"}` }] : []),
    ...(own ? [{ tab: own.tab, label: `${own.name} · ${stageLabel(type!, stage) ?? ""}`.trim() }] : []),
  ];
}

/** S7: the Stage menu's two brackets: every stage under the own tab's name, then the ones on the board. */
export function stageMenu(type: string) {
  const t = WORKFLOW_TYPES[type];
  if (!t) return [];
  return [
    // A2.11: a roadmap item's Won't do asks its reason in the panel, so the menu leaves it out.
    { label: ownTabOf(type)?.name ?? t.label, stages: t.stages.filter((s) => !s.onBoard && !(type === "roadmap_item" && s.closing)) },
    { label: "On the board", stages: t.stages.filter((s) => s.onBoard) },
  ].filter((g) => g.stages.length);
}

/** S4: the Join-board sheet's sprint tick, remembered per person per workspace for 24 hours (call 6). */
export const JOIN_TICK_TTL_MS = 24 * 60 * 60 * 1000;
export function rememberedTick(raw: string | null, now = Date.now()) {
  try {
    const v = raw ? (JSON.parse(raw) as { tick: boolean; at: number }) : null;
    return v && now - v.at < JOIN_TICK_TTL_MS ? v.tick : true;
  } catch {
    return true;
  }
}
