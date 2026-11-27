"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { briefMarkdown, PROGRAM_STATES, programSchema, readProgram, type Measure, type ProgramMark, type ProgramState } from "@/lib/organizations/programs";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 37.5 (plan B8.3a, X4 calls 1–5): an Other organization's programs. Admins start a program from its brief (a
 * private workspace under the organization, marked Program, with an owner), with up to 5 measures. Hours come from X2's
 * shifts tagged to the program (checked in), sessions from the program's finished meetings, and typed numbers wait for
 * an admin's Confirm (every value kept as history). Members see programs they're in and public ones; admins see all.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function org(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; slug: string | null; title: string }>(sql`
    SELECT org_type AS type, slug, title FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "other" || !a.canRead || !(a.isOwner || a.isMember)) return null;
  return { userId, w, admin: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, member: !a.writeBlocked && (a.isOwner || a.memberRole !== "viewer") };
}

type Row = { id: string; title: string; slug: string | null; owner: string; owner_name: string | null; mark: ProgramMark; inside: boolean };
async function programs(orgId: string, userId: string, admin: boolean, only?: string) {
  return Array.from(await db.execute<Row>(sql`
    SELECT w.id, w.title, w.slug, w.owner_id AS owner, coalesce(p.full_name, p.username) AS owner_name, w.org_settings->'program' AS mark,
      EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid AND m.completed_at IS NULL) OR w.owner_id = ${userId}::uuid AS inside
    FROM workspaces w LEFT JOIN profiles p ON p.id = w.owner_id
    WHERE w.parent_id = ${orgId}::uuid AND w.deleted_at IS NULL AND w.org_settings ? 'program' ${only ? sql`AND w.id = ${only}::uuid` : sql``}
      AND (${admin} OR coalesce((w.org_settings->'program'->>'public')::boolean, false) OR w.owner_id = ${userId}::uuid
        OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid AND m.completed_at IS NULL))
    ORDER BY w.title LIMIT 100`));
}

/** The value of each measure: hours (checked-in shifts tagged to it), sessions (finished meetings in it), or the latest confirmed typed number. */
async function values(orgId: string, programId: string, measures: Measure[]) {
  const [hours] = Array.from(await db.execute<{ h: string | null }>(sql`
    SELECT sum(extract(epoch FROM ((t.type_fields->>'end')::timestamptz - (t.type_fields->>'start')::timestamptz)) / 3600)::text AS h
    FROM tasks t JOIN community_rsvps r ON r.task_id = t.id AND r.checked_in_at IS NOT NULL
    WHERE t.workspace_id = ${orgId}::uuid AND t.type_fields->>'kind' = 'shift' AND t.type_fields->>'programId' = ${programId} AND t.deleted_at IS NULL`));
  const [sessions] = Array.from(await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM workspace_documents WHERE workspace_id = ${programId}::uuid AND settings->>'section' = 'meetings' AND settings ? 'finishedAt'`));
  const typed = Array.from(await db.execute<{ measure_id: string; value: string | null; waiting: boolean }>(sql`
    SELECT measure_id, (SELECT n.value::text FROM program_numbers n WHERE n.program_id = ${programId}::uuid AND n.measure_id = x.measure_id AND n.state = 'confirmed' ORDER BY n.confirmed_at DESC LIMIT 1) AS value,
      EXISTS (SELECT 1 FROM program_numbers n WHERE n.program_id = ${programId}::uuid AND n.measure_id = x.measure_id AND n.state = 'waiting') AS waiting
    FROM (SELECT DISTINCT measure_id FROM program_numbers WHERE program_id = ${programId}::uuid) x`));
  return measures.map((m) => {
    const t = typed.find((x) => x.measure_id === m.id);
    const value = m.source === "hours" ? Math.round(Number(hours?.h ?? 0) * 10) / 10 : m.source === "sessions" ? sessions?.n ?? 0 : t?.value != null ? Number(t.value) : null;
    return { ...m, value, waiting: m.source === "typed" && Boolean(t?.waiting) };
  });
}

/** Programs (members): name, state, dates or Ongoing, owner, goal, measures with values; admins also the numbers waiting confirmation. */
export async function readProgramsAction(orgId: string) {
  const ctx = await org(orgId);
  if (!ctx) return DENIED;
  const rows = await programs(orgId, ctx.userId, ctx.admin);
  const out = [];
  for (const r of rows) out.push({ id: r.id, title: r.title, slug: r.inside || ctx.admin ? r.slug ?? r.id : null, owner: r.owner_name, canType: ctx.admin || (r.owner === ctx.userId && ctx.member),
    state: r.mark.state, start: r.mark.start, end: r.mark.end, goal: r.mark.goal, aim: r.mark.aim, public: r.mark.public, measures: await values(orgId, r.id, r.mark.measures ?? []) });
  const waiting = ctx.admin ? Array.from(await db.execute<{ id: string; program: string; measure_id: string; value: string; note: string; by: string | null; at: string }>(sql`
    SELECT n.id, w.title AS program, n.measure_id, n.value::text AS value, n.note, coalesce(p.full_name, p.username) AS by, n.typed_at AS at FROM program_numbers n
    JOIN workspaces w ON w.id = n.program_id LEFT JOIN profiles p ON p.id = n.typed_by WHERE n.org_id = ${orgId}::uuid AND n.state = 'waiting' ORDER BY n.typed_at LIMIT 100`)) : [];
  const people = ctx.admin ? Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 300`)) : [];
  return { success: true as const, admin: ctx.admin, people, programs: out,
    waiting: waiting.map((w) => ({ id: w.id, program: w.program, measure: rows.find((r) => r.title === w.program)?.mark.measures.find((m) => m.id === w.measure_id)?.name ?? w.measure_id, value: Number(w.value), note: w.note, by: w.by, at: new Date(w.at).toISOString() })) };
}

/** Start a program (admins): from its brief, a private workspace under the organization, marked Program, led by its owner. */
export async function startProgramAction(orgId: string, input: unknown): Promise<{ success: true; id: string; slug: string } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.admin) return DENIED;
  const parsed = programSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Give the program a name, an aim and an owner; up to 5 measures." };
  const d = parsed.data;
  if (new Set(d.measures.map((m) => m.id)).size !== d.measures.length) return { success: false, error: "Give the program a name, an aim and an owner; up to 5 measures." };
  const { createWorkspaceAction } = await import("@/lib/workspaces/server/lifecycle");
  const made = await createWorkspaceAction({
    title: d.title, description: `${d.aim} A program of ${ctx.w.title}.`.padEnd(20, "."), project_type: "other", custom_project_type: "Program", visibility: "private", status: "active",
    tags: [], technologies_used: [], lifecycle_stages: [], current_stage_index: 0, member_updates_enabled: true, member_file_upload_default: true, doc_edit_policy: "members", is_draft: false, metadata: {},
    readme: { mode: "skip", publishOnCreate: false, includeRoles: false }, parent_org_id: orgId, lead_user_id: d.ownerId,
  } as Parameters<typeof createWorkspaceAction>[0]);
  if (!made.success || !("project" in made) || !made.project) return { success: false, error: "error" in made && made.error ? made.error : "Couldn’t make the program workspace." };
  const mark: ProgramMark = { aim: d.aim, place: d.place, start: d.start, end: d.end, goal: d.goal, public: d.public, measures: d.measures, brief: d.brief, state: d.start && d.start > new Date().toISOString().slice(0, 10) ? "planned" : "running" };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('program', ${JSON.stringify(mark)}::jsonb) WHERE id = ${made.project.id}::uuid`);
  const { applyCreationIntentAction } = await import("@/app/actions/workspace/doc");
  await applyCreationIntentAction(made.project.id, { mode: "starter", publishOnCreate: true, includeRoles: false, starterContent: briefMarkdown(d.title, d.brief) }).catch(() => undefined);
  return { success: true, id: made.project.id, slug: made.project.slug ?? made.project.id };
}

/** Planned · Running · Paused · Closed (admins); closing keeps a note and the measures' history. */
export async function setProgramStateAction(orgId: string, programId: string, state: ProgramState, closingNote?: string): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.admin || !isLooseUuid(programId) || !PROGRAM_STATES.includes(state)) return DENIED;
  const note = typeof closingNote === "string" ? closingNote.trim().slice(0, 500) : "";
  const done = Array.from(await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{program}', org_settings->'program' || jsonb_build_object('state', ${state}::text${state === "closed" ? sql`, 'closingNote', ${note}::text` : sql``}))
    WHERE id = ${programId}::uuid AND parent_id = ${orgId}::uuid AND org_settings ? 'program' AND deleted_at IS NULL RETURNING id`));
  return done.length ? { success: true } : DENIED;
}

/** Type a number for a typed measure (the program's owner or admins); it waits for an admin's Confirm. */
export async function typeNumberAction(orgId: string, programId: string, measureId: string, value: number, note = ""): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !isLooseUuid(programId) || typeof measureId !== "string" || !(Number.isFinite(value) && value >= 0 && value < 1e12)) return DENIED;
  const [r] = await programs(orgId, ctx.userId, true, programId);
  if (!r || !(ctx.admin || r.owner === ctx.userId)) return DENIED;
  if (!(r.mark.measures ?? []).some((m) => m.id === measureId && m.source === "typed")) return { success: false, error: "Only typed measures take a number; hours and sessions count themselves." };
  await db.execute(sql`INSERT INTO program_numbers (org_id, program_id, measure_id, value, note, typed_by) VALUES (${orgId}::uuid, ${programId}::uuid, ${measureId}, ${Math.round(value * 100) / 100}, ${String(note).slice(0, 500)}, ${ctx.userId}::uuid)`);
  const admins = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role IN ('owner', 'admin') AND completed_at IS NULL LIMIT 20`));
  const slug = ctx.w.slug ?? orgId;
  for (const a of admins) if (a.id !== ctx.userId) await createNotification({ recipientUserId: a.id, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
    title: "Program numbers are waiting for confirmation", href: `/org/${encodeURIComponent(slug)}`, entityRefs: { projectId: orgId, projectSlug: slug }, dedupeKey: `program-numbers:${orgId}:${a.id}:${new Date().toISOString().slice(0, 10)}` }).catch(() => undefined);
  return { success: true };
}

/** Confirm (or decline) a typed number (admins). Only confirmed numbers reach reports and About; earlier values stay as history. */
export async function confirmNumberAction(orgId: string, numberId: string, confirm: boolean): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.admin || !isLooseUuid(numberId) || typeof confirm !== "boolean") return DENIED;
  const done = Array.from(await db.execute(sql`UPDATE program_numbers SET state = ${confirm ? "confirmed" : "declined"}, confirmed_by = ${ctx.userId}::uuid, confirmed_at = now()
    WHERE id = ${numberId}::uuid AND org_id = ${orgId}::uuid AND state = 'waiting' RETURNING id`));
  return done.length ? { success: true } : DENIED;
}
