"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { expectedPace, goalSettings, goalStatus, krProgress, objectiveProgress, periodLabel, periodOf, periodRange, type GoalStatus } from "@/lib/workflows/goals";
import { companyLike } from "@/lib/organizations/kits";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 33.4 (plan B4.3, K3): company and team goals together. Goals are the existing objectives and key results
 * (11.4, D3), read for the company's period, which teams follow (call 2). A project — a team workspace in the company —
 * supports one goal (call 3), has optional dates (call 4) and posts a status with one line (call 5). Progress comes only
 * from key results (call 6). Every member sees the goals; a private project shows only as "Private project" with its
 * status to people outside it (call 7). Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
export type ProjectStatus = "on_track" | "at_risk" | "off_track";
type ProjectSettings = { supports?: string | null; start?: string | null; end?: string | null; status?: { status: ProjectStatus; line: string; at: string } | null };

async function companyOf(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; org: unknown }>(sql`
    SELECT org_type AS type, workflow_settings AS settings, org_settings AS org FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  // B8.8: an Other organization with Goals and projects on (the Public-sector kit).
  if (!w || !companyLike(w.type, w.org, "goals") || !(a.isOwner || a.isMember)) return null;
  return { userId, admin: a.isOwner || a.memberRole === "admin", gs: goalSettings((w.settings as { goals?: unknown } | null)?.goals) };
}

export type GoalRow = { id: string; title: string; owner: string | null; team: string | null; teamId: string; progress: number; status: GoalStatus; contributesTo: string | null };
export type ProjectRow = { id: string; title: string; slug: string | null; masked: boolean; supports: string | null; start: string | null; end: string | null;
  status: { status: ProjectStatus; line: string; at: string } | null; done: number; total: number };

/** Goals (company, then team goals that contribute) and the company's projects with what they support and their status. */
export async function readCompanyGoalsAction(orgId: string) {
  const ctx = await companyOf(orgId);
  if (!ctx) return DENIED;
  const today = new Date().toISOString().slice(0, 10);
  const period = periodOf(today, ctx.gs);
  const range = periodRange(period, ctx.gs);
  const pace = expectedPace(range.start, range.end, new Date());
  const items = Array.from(await db.execute<{ id: string; title: string; type: string; part_of_id: string | null; fields: Record<string, unknown> | null; workspace_id: string; team: string; owner: string | null }>(sql`
    SELECT t.id, t.title, t.item_type AS type, t.part_of_id, t.type_fields AS fields, t.workspace_id, w.title AS team, coalesce(p.full_name, p.username) AS owner
    FROM tasks t JOIN workspaces w ON w.id = t.workspace_id LEFT JOIN profiles p ON p.id = t.assignee_id
    JOIN workspace_documents d ON d.id = t.source_doc_id AND d.settings->>'section' = 'goals' AND d.settings->>'period' = ${period}
    WHERE (w.id = ${orgId}::uuid OR (w.parent_id = ${orgId}::uuid AND w.deleted_at IS NULL AND w.status <> 'archived'
        -- Security review (B4.3): a private team's goals stay with its people and the company's admins.
        AND (${ctx.admin} OR w.visibility <> 'private' OR w.owner_id = ${ctx.userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${ctx.userId}::uuid))))
      -- The company's goals document while it's a draft is for its admins (report §37.4).
      AND (${ctx.admin} OR w.id <> ${orgId}::uuid OR coalesce(d.settings->'org'->>'lifecycle', 'published') <> 'draft')
      AND t.deleted_at IS NULL AND t.item_type IN ('objective', 'key_result') LIMIT 2000`));
  // Call 6: progress only from key results; links show alignment and never add up.
  const goals: GoalRow[] = items.filter((i) => i.type === "objective").map((o) => {
    const krs = items.filter((k) => k.type === "key_result" && k.part_of_id === o.id).map((k) => {
      const f = k.fields ?? {};
      return krProgress({ start: Number(f.start ?? 0), target: Number(f.target ?? 0), current: f.current == null ? null : Number(f.current), direction: f.direction === "decrease" ? "decrease" : "increase" });
    });
    const progress = objectiveProgress(krs);
    const f = o.fields ?? {};
    const override = (f.statusOverride as { status: GoalStatus } | null | undefined)?.status;
    return { id: o.id, title: o.title, owner: o.owner, team: o.workspace_id === orgId ? null : o.team, teamId: o.workspace_id, progress,
      status: override ?? goalStatus(progress, pace, ctx.gs.bands), contributesTo: typeof f.contributesTo === "string" ? f.contributesTo : null };
  });
  const projects = Array.from(await db.execute<{ id: string; title: string; slug: string | null; visibility: string | null; settings: unknown; mine: boolean; done: number; total: number }>(sql`
    SELECT w.id, w.title, w.slug, w.visibility, w.workflow_settings->'project' AS settings,
      EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${ctx.userId}::uuid) OR w.owner_id = ${ctx.userId}::uuid AS mine,
      (SELECT count(*) FILTER (WHERE t.status = 'done')::int FROM tasks t WHERE t.workspace_id = w.id AND t.deleted_at IS NULL) AS done,
      (SELECT count(*)::int FROM tasks t WHERE t.workspace_id = w.id AND t.deleted_at IS NULL) AS total
    FROM workspaces w WHERE w.parent_id = ${orgId}::uuid AND w.deleted_at IS NULL AND w.status <> 'archived' ORDER BY w.title LIMIT 300`)).map((p): ProjectRow => {
    const s = (p.settings ?? {}) as ProjectSettings;
    const masked = p.visibility === "private" && !p.mine && !ctx.admin;
    return { id: masked ? `private-${p.id.slice(0, 8)}` : p.id, title: masked ? "Private project" : p.title, slug: masked ? null : p.slug, masked,
      supports: s.supports ?? null, start: masked ? null : s.start ?? null, end: masked ? null : s.end ?? null, status: s.status ?? null,
      done: masked ? 0 : Number(p.done), total: masked ? 0 : Number(p.total) };
  });
  return { success: true as const, admin: ctx.admin, period, label: periodLabel(period), range, goals, projects,
    // Call 8: a list for admins, never a warning to teams.
    notLinked: ctx.admin ? projects.filter((p) => !p.supports).map((p) => p.title) : [],
    goalsDoc: Array.from(await db.execute<{ slug: string }>(sql`SELECT slug FROM workspace_documents WHERE workspace_id = ${orgId}::uuid AND settings->>'section' = 'goals' AND settings->>'period' = ${period} LIMIT 1`))[0]?.slug ?? null };
}

/** A project (a workspace in a company) and whether the viewer runs it (its owner or admins). */
async function projectOf(projectId: string) {
  if (!isLooseUuid(projectId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(projectId, userId);
  const [w] = Array.from(await db.execute<{ parent: string | null; type: string | null; org: unknown }>(sql`
    SELECT w.parent_id AS parent, o.org_type AS type, o.org_settings AS org FROM workspaces w LEFT JOIN workspaces o ON o.id = w.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
    WHERE w.id = ${projectId}::uuid AND w.kind = 'workspace' AND w.deleted_at IS NULL`));
  if (!w?.parent || !companyLike(w.type, w.org, "goals") || !(a.isOwner || a.isMember)) return null;
  return { userId, companyId: w.parent, lead: a.isOwner || a.memberRole === "admin" || a.memberRole === "owner", member: a.isOwner || (a.isMember && a.memberRole !== "viewer") };
}

async function writeProject(projectId: string, patch: ProjectSettings) {
  await db.execute(sql`UPDATE workspaces SET workflow_settings = jsonb_set(coalesce(workflow_settings, '{}'::jsonb), '{project}', coalesce(workflow_settings->'project', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb), updated_at = now() WHERE id = ${projectId}::uuid`);
}

/** The project header line: what it supports, its dates and its latest status, and the goals it can pick from. */
export async function readProjectGoalLineAction(projectId: string) {
  const ctx = await projectOf(projectId);
  if (!ctx) return { success: true as const, project: null };
  const [w] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT workflow_settings->'project' AS settings FROM workspaces WHERE id = ${projectId}::uuid`));
  const goals = await readCompanyGoalsAction(ctx.companyId);
  const s = (w?.settings ?? {}) as ProjectSettings;
  return { success: true as const, project: { lead: ctx.lead, member: ctx.member, supports: s.supports ?? null, start: s.start ?? null, end: s.end ?? null, status: s.status ?? null,
    goals: goals.success ? goals.goals.map((g) => ({ id: g.id, title: g.title, team: g.team })) : [], label: goals.success ? goals.label : null } };
}

/** Supports (call 3): one goal, the company's or a team's in the same company. The project's owner and admins. */
export async function setProjectSupportsAction(projectId: string, goalId: string | null): Promise<{ success: true } | Failure> {
  const ctx = await projectOf(projectId);
  if (!ctx?.lead || (goalId !== null && !isLooseUuid(goalId))) return DENIED;
  if (goalId) {
    const [ok] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
      WHERE t.id = ${goalId}::uuid AND t.item_type = 'objective' AND t.deleted_at IS NULL AND (w.id = ${ctx.companyId}::uuid OR w.parent_id = ${ctx.companyId}::uuid)) AS ok`));
    if (!ok?.ok) return { success: false, error: "Pick one of the company’s goals." };
  }
  await writeProject(projectId, { supports: goalId });
  return { success: true };
}

const day = z.string().date().nullable();
/** Project dates (call 4): optional start and end. The project's owner and admins. */
export async function setProjectDatesAction(projectId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await projectOf(projectId);
  if (!ctx?.lead) return DENIED;
  const parsed = z.object({ start: day, end: day }).strict().safeParse(input);
  if (!parsed.success) return { success: false, error: "Pick the dates." };
  if (parsed.data.start && parsed.data.end && parsed.data.end < parsed.data.start) return { success: false, error: "The end can’t be before the start." };
  await writeProject(projectId, parsed.data);
  return { success: true };
}

/** Post status (call 5): On track, At risk or Off track and one line, also posted as an Update in the project. */
export async function postProjectStatusAction(projectId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await projectOf(projectId);
  if (!ctx?.lead) return DENIED;
  const parsed = z.object({ status: z.enum(["on_track", "at_risk", "off_track"]), line: z.string().trim().min(1, "Write one line.").max(200) }).strict().safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Pick a status." };
  const word = { on_track: "On track", at_risk: "At risk", off_track: "Off track" }[parsed.data.status];
  await writeProject(projectId, { status: { ...parsed.data, at: new Date().toISOString() } });
  const { createWorkspaceUpdateAction } = await import("@/app/actions/workspace/updates");
  await createWorkspaceUpdateAction(projectId, { content: `Status: ${word} — ${parsed.data.line}`, updateType: "progress", visibility: "members" }).catch(() => undefined);
  return { success: true };
}

/** Contributes to (11.4, D3 W8): a team goal points at one company goal. Its team's owner and admins. */
export async function setContributesToAction(teamId: string, objectiveId: string, companyGoalId: string | null): Promise<{ success: true } | Failure> {
  const ctx = await projectOf(teamId);
  if (!ctx?.lead || !isLooseUuid(objectiveId) || (companyGoalId !== null && !isLooseUuid(companyGoalId))) return DENIED;
  if (companyGoalId) {
    const [ok] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM tasks WHERE id = ${companyGoalId}::uuid AND workspace_id = ${ctx.companyId}::uuid AND item_type = 'objective' AND deleted_at IS NULL) AS ok`));
    if (!ok?.ok) return { success: false, error: "Pick one of the company’s goals." };
  }
  const rows = Array.from(await db.execute<{ id: string }>(sql`UPDATE tasks SET type_fields = coalesce(type_fields, '{}'::jsonb) || jsonb_build_object('contributesTo', ${companyGoalId}::text), updated_at = now()
    WHERE id = ${objectiveId}::uuid AND workspace_id = ${teamId}::uuid AND item_type = 'objective' AND deleted_at IS NULL RETURNING id`));
  return rows.length ? { success: true } : DENIED;
}
