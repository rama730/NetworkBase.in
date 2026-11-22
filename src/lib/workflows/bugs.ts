import { z } from "zod";

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
