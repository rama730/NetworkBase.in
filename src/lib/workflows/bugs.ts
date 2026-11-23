import { z } from "zod";

import { WORKFLOW_TYPES } from "@/lib/workflows/types";

/**
 * Report 38.6 T3 part 5 and 7 (plan A2.1): a bug is a task with item_type "bug"; its own fields live in type_fields.
 * Severity sets priority (call 3); Not sure (null) is allowed when reporting and required away at Confirm (call 4).
 */
export const SEVERITIES = [
  { key: "urgent", label: "Urgent" },
  { key: "major", label: "Major" },
  { key: "minor", label: "Minor" },
] as const;
export type Severity = (typeof SEVERITIES)[number]["key"];
export const severityLabel = (s: string | null | undefined) => SEVERITIES.find((x) => x.key === s)?.label ?? "Not sure";

const where = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("web"), browser: z.string().max(40).default(""), version: z.string().max(40).default("") }).strict(),
  z.object({ kind: z.literal("app"), platform: z.string().max(40).default(""), version: z.string().max(40).default("") }).strict(),
  z.object({ kind: z.literal("other"), text: z.string().max(200) }).strict(),
]);
export type Where = z.infer<typeof where>;

/** The bug's own fields as people set them (the report form and the panel); alsoSeen and duplicateOf have actions. */
export const bugFieldsSchema = z.object({
  severity: z.enum(["urgent", "major", "minor"]).nullable().optional(),
  steps: z.string().max(5000).optional(),
  expected: z.string().max(2000).optional(),
  where: where.nullable().optional(),
  foundIn: z.string().trim().max(40).optional(),
  fixedIn: z.string().trim().max(40).optional(),
}).strict();
export type BugFields = z.infer<typeof bugFieldsSchema> & { alsoSeen?: string[]; duplicateOf?: string | null };

export const priorityForSeverity = (s: Severity | null | undefined) => (s === "urgent" ? "urgent" : s === "major" ? "high" : s === "minor" ? "medium" : null);

const OPEN = new Set(["new", "confirmed", "fixing"]);
type Bugish = { stage: string | null; typeFields?: Record<string, unknown> | null };
const sev = (b: Bugish) => (b.typeFields?.severity as Severity | null | undefined) ?? null;
const seenCount = (b: Bugish) => (Array.isArray(b.typeFields?.alsoSeen) ? (b.typeFields!.alsoSeen as unknown[]).length : 0);

/** S2: open bugs (New, Confirmed, Fixing) by severity; Not sure counted on its own. */
export function openSeverityCounts(bugs: Bugish[]) {
  const out = { urgent: 0, major: 0, minor: 0, notSure: 0 };
  for (const b of bugs) if (OPEN.has(b.stage ?? "")) out[sev(b) ?? "notSure"] += 1;
  return out;
}

/** S4: New bugs, oldest first; on the same day, more people seeing it first. */
export function triageOrder<T extends Bugish & { createdAt: string }>(bugs: T[]) {
  return bugs.filter((b) => b.stage === "new").sort((a, b) => a.createdAt.slice(0, 10).localeCompare(b.createdAt.slice(0, 10)) || seenCount(b) - seenCount(a) || a.createdAt.localeCompare(b.createdAt));
}

export function whereLabel(w: Where | null | undefined) {
  if (!w) return null;
  if (w.kind === "other") return w.text || null;
  const name = [w.kind === "web" ? w.browser : w.platform, w.version].filter(Boolean).join(" ");
  return `${w.kind === "web" ? "Web" : "App"}${name ? ` · ${name}` : ""}`;
}

/** W12: Fixed and Verified bugs by Fixed in, the newest version first; No version last. */
export function fixedGroups<T extends Bugish & { updatedAt: string }>(bugs: T[]) {
  const done = bugs.filter((b) => b.stage === "fixed" || b.stage === "verified").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const groups = new Map<string, T[]>();
  for (const b of done) {
    const name = (b.typeFields?.fixedIn as string | undefined)?.trim() || "No version";
    groups.set(name, [...(groups.get(name) ?? []), b]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === "No version" ? 1 : b === "No version" ? -1 : 0)).map(([name, list]) => ({ name, bugs: list }));
}

const STAGE_ORDER = ["new", "confirmed", "fixing", "fixed", "verified"];
/** W12 Mine: Urgent · Major · Minor · Not sure, each by stage. */
export function severityGroups<T extends Bugish>(bugs: T[]) {
  return [...SEVERITIES.map((s) => ({ key: s.key as string | null, name: s.label })), { key: null, name: "Not sure" }]
    .map((g) => ({ name: g.name, bugs: bugs.filter((b) => sev(b) === g.key).sort((a, b) => STAGE_ORDER.indexOf(a.stage ?? "") - STAGE_ORDER.indexOf(b.stage ?? "")) }))
    .filter((g) => g.bugs.length);
}

/** Report 38.6 W5 (plan A2.2): where a Duplicate points: the open original at the end of the chain, never a loop. */
export function resolveDuplicateTarget(bugId: string, targetId: string, bugs: Map<string, { stage: string | null; duplicateOf: string | null }>): { id: string } | { error: string } {
  if (bugId === targetId) return { error: "A bug can’t be a duplicate of itself" };
  const seen = new Set([bugId]);
  let id = targetId;
  for (let i = 0; i < 50; i++) {
    const bug = bugs.get(id);
    if (!bug) return { error: "Pick a bug in this workspace" };
    if (seen.has(id)) return { error: "That bug is already a duplicate of this one" };
    seen.add(id);
    if (bug.stage === "duplicate" && bug.duplicateOf) {
      if (bug.duplicateOf === bugId) return { error: "That bug is already a duplicate of this one" };
      id = bug.duplicateOf;
      continue;
    }
    return OPEN.has(bug.stage ?? "") ? { id } : { error: "Pick an open bug" };
  }
  return { error: "Pick an open bug" };
}

/** W5.2: the target's I see this too after a merge: its own, then the source's reporter and people; 500 at most. */
export function mergeOnDuplicate(source: { creatorId: string | null; alsoSeen: string[] }, target: { creatorId: string | null; alsoSeen: string[] }) {
  const out = [...target.alsoSeen];
  for (const id of [source.creatorId, ...source.alsoSeen]) if (id && id !== target.creatorId && !out.includes(id)) out.push(id);
  return out.slice(0, 500);
}

/** W10 (A2.3): a message prefills the New module — first line as the title (200 max), the message as What happened?. */
export function bugFromMessage(text: string) {
  const body = text.trim();
  const first = body.split("\n")[0]!.trim();
  return { title: first.length > 200 ? `${first.slice(0, 199)}…` : first, steps: body.slice(0, 5000) };
}

/** W10: the message's files are named under What happened? (they stay in the message, which the bug links to). */
export function withFiles(steps: string, files: string[]) {
  const tail = files.length ? `\n\nFiles in the message: ${files.join(", ")}` : "";
  return `${steps.slice(0, 5000 - tail.length)}${tail}`.trim();
}

/** Rollout 3 (A2.3): Change type's default stage for a bug — Confirmed, Fixing once work started, Fixed when done. */
export const changeTypeStage = (status: string) => (status === "done" ? "fixed" : status === "todo" || status === "backlog" ? "confirmed" : "fixing");

const family = (status: string) => (status === "done" ? "done" : status === "todo" || status === "backlog" ? "todo" : "in_progress");
/** The stages a task can become a bug at: the default first, then the others that keep its status (never a closing one). */
export function changeTypeOptions(status: string) {
  const first = changeTypeStage(status);
  const rest = WORKFLOW_TYPES.bug!.stages.filter((s) => !s.closing && s.key !== first && family(s.status) === family(status)).map((s) => s.key);
  return [first, ...rest];
}

/** S2 (A2.3): the tab's search (title words, or NB-12 / #12) and Assigned to (me, people, none). */
export function filterBugs<T extends { title: string; taskNumber: number | null; assigneeId: string | null }>(bugs: T[], f: { q: string; assignee: string[] }, me: string | null) {
  const q = f.q.trim().toLowerCase();
  const num = /^(?:[a-z][a-z0-9]*-|#)?(\d+)$/i.exec(q)?.[1];
  return bugs.filter((b) => (!q || (num ? b.taskNumber === Number(num) : q.split(/\s+/).every((w) => b.title.toLowerCase().includes(w))))
    && (!f.assignee.length || f.assignee.some((a) => (a === "none" ? !b.assigneeId : (a === "me" ? me : a) === b.assigneeId))));
}

type CsvBug = { taskNumber: number | null; title: string; stage: string | null; assigneeName: string | null; creatorName: string | null; createdAt: string; typeFields: Record<string, unknown> };
/** S2 (A2.3): Export CSV, the bugs shown, in words. */
export function bugsCsv(bugs: CsvBug[], key: string | null) {
  return [
    ["Bug", "Title", "Stage", "Severity", "Where", "Reported by", "Assigned to", "See it too", "Fixed in", "Reported"],
    ...bugs.map((b) => [
      key && b.taskNumber ? `${key}-${b.taskNumber}` : b.taskNumber ? `#${b.taskNumber}` : "", b.title,
      WORKFLOW_TYPES.bug!.stages.find((s) => s.key === b.stage)?.label ?? "New", severityLabel(b.typeFields.severity as string | null),
      whereLabel(b.typeFields.where as Where | null) ?? "", b.creatorName ?? "", b.assigneeName ?? "",
      Array.isArray(b.typeFields.alsoSeen) ? b.typeFields.alsoSeen.length : 0, String(b.typeFields.fixedIn ?? ""), b.createdAt.slice(0, 10),
    ]),
  ];
}
