"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { mentorsOf } from "@/lib/organizations/mentoring-server";
import { capstoneSchema, readCapstone, readyBlock, showcasePublic, type Capstone } from "@/lib/workflows/capstone";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 31.6 C4 (plan B2.5a): a capstone team's workspace (the Capstone workflow), its Showcase card, the class's
 * Showcase (members see every Ready card; visitors only cards every member agreed to show), and the staff table.
 * Judges, the Run of show and awards come with B2.5b.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function viewer() {
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  return { userId: auth.user?.id ?? null, token: auth.tokenKind != null };
}

async function team(projectId: string) {
  const [w] = Array.from(await db.execute<{ id: string; title: string; slug: string | null; parent_id: string | null; owner_id: string; settings: unknown; cover: string | null }>(sql`
    SELECT id, title, slug, parent_id, owner_id, workflow_settings AS settings, cover_image AS cover FROM workspaces WHERE id = ${projectId}::uuid AND deleted_at IS NULL AND kind = 'workspace'`));
  if (!w) return null;
  const members = Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM profiles p
    WHERE p.id = ${w.owner_id}::uuid OR p.id IN (SELECT user_id FROM workspace_members WHERE workspace_id = ${projectId}::uuid AND role IN ('owner', 'admin', 'member')) ORDER BY 2`));
  // Milestones: the class's each-team assignments, as this team's copies.
  const milestones = Array.from(await db.execute<{ id: string; title: string; due: string | null; done: boolean }>(sql`
    SELECT id, title, due_date::text AS due, (status = 'done' OR excused_at IS NOT NULL) AS done FROM tasks
    WHERE workspace_id = ${projectId}::uuid AND assignment_id IS NOT NULL AND deleted_at IS NULL ORDER BY due_date NULLS LAST`));
  return { w, capstone: readCapstone(w.settings), members, milestones };
}

export async function readCapstoneAction(projectId: string) {
  try {
    const { userId } = await viewer();
    if (!userId || !isLooseUuid(projectId)) return DENIED;
    const a = await getWorkspaceAccessById(projectId, userId);
    if (!a.canRead || !(a.isOwner || a.isMember)) return DENIED;
    const { readWorkspaceWorkflows } = await import("@/lib/workflows/server");
    if (!(await readWorkspaceWorkflows(projectId, userId)).added.some((w) => w.workflow === "capstone")) return { success: false as const, error: "Add Capstone first." };
    const t = await team(projectId);
    if (!t) return DENIED;
    const mentors = t.w.parent_id ? [...new Map((await Promise.all(t.members.map((m) => mentorsOf(t.w.parent_id!, m.id)))).flat().map((m) => [m.id, m])).values()] : [];
    const next = t.milestones.find((m) => !m.done) ?? null;
    return { success: true as const, canEdit: a.canWrite, me: userId, title: t.w.title, capstone: t.capstone, members: t.members, mentors,
      milestones: t.milestones, next, readyBlock: readyBlock(t.capstone, t.milestones), public: showcasePublic(t.capstone.showcase.consents, t.members.map((m) => m.id)) };
  } catch (error) {
    logger.warn("capstone.read_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the capstone." };
  }
}

const patchInput = capstoneSchema.pick({ problem: true, audience: true, metrics: true, roles: true }).partial()
  .extend({ showcase: z.object({ title: z.string().trim().max(120), line: z.string().trim().max(200), links: capstoneSchema.shape.showcase.removeDefault().shape.links, track: z.string().trim().max(40) }).partial().optional() }).strict();

/** The team edits the brief, roles and the card's words (editors of the workspace); Ready and consent have their own. */
export async function saveCapstoneAction(projectId: string, input: unknown): Promise<{ success: true } | Failure> {
  const { userId, token } = await viewer();
  if (!userId || token || !isLooseUuid(projectId)) return DENIED;
  const a = await getWorkspaceAccessById(projectId, userId);
  if (!a.canWrite || !(a.isOwner || a.isMember)) return DENIED;
  const parsed = patchInput.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Check the brief." };
  const t = await team(projectId);
  if (!t) return DENIED;
  const p = parsed.data;
  if (p.roles && Object.keys(p.roles).some((id) => !t.members.some((m) => m.id === id))) return { success: false, error: "Roles are for this team’s members." };
  const card = { ...t.capstone.showcase, ...(p.showcase ?? {}), links: { ...t.capstone.showcase.links, ...(p.showcase?.links ?? {}) } };
  // Security review: everyone agreed to the card as it was; changing what it says asks them again (the editor's own
  // agreement stays if they'd given it).
  const words = (s: typeof card) => JSON.stringify([s.title, s.line, s.track, s.links]);
  const consents = words(card) === words(t.capstone.showcase) ? card.consents : (card.consents[userId] ? { [userId]: new Date().toISOString() } : {});
  const next: Capstone = { ...t.capstone, ...(p.problem !== undefined ? { problem: p.problem } : {}), ...(p.audience !== undefined ? { audience: p.audience } : {}),
    ...(p.metrics ? { metrics: p.metrics } : {}), ...(p.roles ? { roles: p.roles } : {}), showcase: { ...card, consents } };
  await db.execute(sql`UPDATE workspaces SET workflow_settings = coalesce(workflow_settings, '{}'::jsonb) || jsonb_build_object('capstone', ${JSON.stringify(next)}::jsonb) WHERE id = ${projectId}::uuid`);
  return { success: true };
}

/** Ready (with every milestone done) or back to Draft. */
export async function setShowcaseReadyAction(projectId: string, ready: boolean): Promise<{ success: true } | Failure> {
  const { userId, token } = await viewer();
  if (!userId || token || !isLooseUuid(projectId)) return DENIED;
  const a = await getWorkspaceAccessById(projectId, userId);
  if (!a.canWrite || !(a.isOwner || a.isMember)) return DENIED;
  const t = await team(projectId);
  if (!t) return DENIED;
  if (ready) { const block = readyBlock(t.capstone, t.milestones); if (block) return { success: false, error: block }; }
  await db.execute(sql`UPDATE workspaces SET workflow_settings = jsonb_set(coalesce(workflow_settings, '{}'::jsonb), '{capstone}',
    coalesce(workflow_settings->'capstone', '{}'::jsonb) || jsonb_build_object('showcase', coalesce(workflow_settings->'capstone'->'showcase', '{}'::jsonb) || jsonb_build_object('readyAt', ${ready ? new Date().toISOString() : null}::text)))
    WHERE id = ${projectId}::uuid`);
  return { success: true };
}

/** Each member agrees (or not) to show the card publicly, for themselves only (call 6). */
export async function consentShowcaseAction(projectId: string, agree: boolean): Promise<{ success: true } | Failure> {
  const { userId, token } = await viewer();
  if (!userId || token || !isLooseUuid(projectId)) return DENIED;
  const t = await team(projectId);
  if (!t || !t.members.some((m) => m.id === userId)) return DENIED;
  await db.execute(sql`UPDATE workspaces SET workflow_settings = jsonb_set(coalesce(workflow_settings, '{}'::jsonb), '{capstone}',
    coalesce(workflow_settings->'capstone', '{}'::jsonb) || jsonb_build_object('showcase', coalesce(workflow_settings->'capstone'->'showcase', '{}'::jsonb)
      || jsonb_build_object('consents', ${agree ? sql`coalesce(workflow_settings->'capstone'->'showcase'->'consents', '{}'::jsonb) || jsonb_build_object(${userId}::text, ${new Date().toISOString()}::text)`
        : sql`coalesce(workflow_settings->'capstone'->'showcase'->'consents', '{}'::jsonb) - ${userId}::text`})))
    WHERE id = ${projectId}::uuid`);
  return { success: true };
}

/** The class's teams with the Capstone workflow, and the class access of the viewer. */
async function classTeams(classId: string) {
  const rows = Array.from(await db.execute<{ id: string; title: string; slug: string | null; owner_id: string; settings: unknown; cover: string | null }>(sql`
    SELECT w.id, w.title, w.slug, w.owner_id, w.workflow_settings AS settings, w.cover_image AS cover FROM workspaces w
    WHERE w.parent_id = ${classId}::uuid AND w.deleted_at IS NULL AND w.kind = 'workspace'
      AND EXISTS (SELECT 1 FROM workspace_workflows f WHERE f.workspace_id = w.id AND f.workflow = 'capstone' AND f.hidden_at IS NULL) ORDER BY w.title`));
  const out = [];
  for (const r of rows) { const t = await team(r.id); if (t) out.push({ ...r, ...t }); }
  return out;
}

/** About → Showcase: members of the class see every Ready card; anyone else only the ones every member agreed to. */
export async function readShowcaseAction(classId: string) {
  try {
    if (!isLooseUuid(classId)) return DENIED;
    const { userId } = await viewer();
    const a = await getWorkspaceAccessById(classId, userId);
    if (!a.canRead) return DENIED;
    const insider = a.isOwner || a.isMember;
    const cards = (await classTeams(classId)).filter((t) => t.capstone.showcase.readyAt && (insider || showcasePublic(t.capstone.showcase.consents, t.members.map((m) => m.id))))
      .map((t) => ({ id: t.id, slug: t.slug, title: t.capstone.showcase.title || t.title, line: t.capstone.showcase.line, track: t.capstone.showcase.track || null, links: t.capstone.showcase.links, cover: t.cover,
        team: insider ? t.members.map((m) => m.name) : null }));
    return { success: true as const, cards, tracks: [...new Set(cards.map((c) => c.track).filter((x): x is string => Boolean(x)))] };
  } catch (error) {
    logger.warn("capstone.showcase_failed", { classId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the showcase." };
  }
}

/** Staff: Team · Brief · Mentor · Next milestone · Showcase (the class's owner and admins). */
export async function readCapstoneTeamsAction(classId: string) {
  const { userId } = await viewer();
  if (!userId || !isLooseUuid(classId)) return DENIED;
  const a = await getWorkspaceAccessById(classId, userId);
  if (a.project?.kind !== "organization" || !a.canRead || !(a.isOwner || a.memberRole === "admin")) return DENIED;
  const teams = await classTeams(classId);
  const now = Date.now();
  const rows = [];
  for (const t of teams) {
    const mentors = [...new Map((await Promise.all(t.members.map((m) => mentorsOf(classId, m.id)))).flat().map((m) => [m.id, m.name])).values()];
    const next = t.milestones.find((m) => !m.done) ?? null;
    rows.push({ id: t.id, slug: t.slug, title: t.title, size: t.members.length, problem: t.capstone.problem || null, mentors,
      next: next ? { title: next.title, due: next.due, overdue: Boolean(next.due && Date.parse(next.due) < now) } : null,
      done: t.milestones.filter((m) => m.done).length, total: t.milestones.length,
      showcase: t.capstone.showcase.readyAt ? (showcasePublic(t.capstone.showcase.consents, t.members.map((m) => m.id)) ? "public" : "ready") : t.capstone.showcase.title ? "draft" : "none" });
  }
  return { success: true as const, rows };
}
