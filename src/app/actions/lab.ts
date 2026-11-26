"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { alumniSchema, finishSchema, LEAVING_PLAN, labSettingsSchema, leavingDue, looksLikeContact, positionSchema, readLabSettings, readPosition, type LeavingRecord } from "@/lib/organizations/lab";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 35.2 (plan B6.1a, R1): a research lab's home, People by position and Settings → Lab. Positions are labels on
 * memberships (view_prefs.lab) set by the PI and Researchers; they never change permissions (call 2). Members (not
 * viewers) read People; visitors never do. Contact is Message and an office-hours line, no email or phone (call 7).
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function lab(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; owner: string; description: string | null; settings: unknown }>(sql`
    SELECT org_type AS type, owner_id AS owner, description, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "research" || !a.canRead || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  // Review: an archived, suspended or deleting lab reads but takes no changes.
  return { userId, owner: w.owner, description: w.description, blocked: Boolean(a.writeBlocked), admin: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, settings: readLabSettings(w.settings) };
}

/** Alumni are people who finished and aren't back (or blocked): a current member shows in People instead (review). */
const alumniStill = sql`NOT EXISTS (SELECT 1 FROM workspace_members cm WHERE cm.workspace_id = a.workspace_id AND cm.user_id = a.user_id AND cm.role <> 'viewer')
  AND NOT EXISTS (SELECT 1 FROM org_join_blocks j WHERE j.org_id = a.workspace_id AND j.user_id = a.user_id)`;

async function targetIsResearcher(orgId: string, userId: string) {
  const [r] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND role = 'admin') AS ok`));
  return Boolean(r?.ok);
}

async function stillLead(orgId: string, userId: string | null) {
  if (!userId) return false;
  const [r] = Array.from(await db.execute<{ ok: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND role IN ('owner', 'admin') AND completed_at IS NULL) AS ok`));
  return Boolean(r?.ok);
}

export type LabPerson = { id: string; name: string; username: string | null; avatarUrl: string | null; role: "pi" | "researcher" | "member";
  position: string | null; startYear: number | null; supervisor: string | null; leavingOn: string | null; interests: string[]; workspaces: Array<{ id: string; title: string; slug: string | null }> };

/** Members → People (members): everyone by position, with interests and the lab workspaces they're in. */
export async function readLabPeopleAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; name: string | null; username: string | null; avatar_url: string | null; role: string; prefs: unknown; interests: unknown; workspaces: unknown }>(sql`
    SELECT p.id, p.full_name AS name, p.username, p.avatar_url, CASE WHEN w.owner_id = m.user_id THEN 'owner' ELSE m.role END AS role, m.view_prefs AS prefs, p.interests,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'slug', c.slug) ORDER BY c.title), '[]'::jsonb) FROM workspaces c
        JOIN workspace_members cm ON cm.workspace_id = c.id AND cm.user_id = m.user_id WHERE c.parent_id = w.id AND c.deleted_at IS NULL AND c.status <> 'archived'
          -- Review: members see a person's open workspaces (or ones they're in); the PI and Researchers see all.
          AND (${ctx.admin} OR (c.visibility <> 'private' AND c.status <> 'draft')
            OR EXISTS (SELECT 1 FROM workspace_members v WHERE v.workspace_id = c.id AND v.user_id = ${ctx.userId}::uuid))) AS workspaces
    FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND p.deleted_at IS NULL
      AND (m.user_id = ${ctx.userId}::uuid OR NOT app_private.blocked_between(${ctx.userId}::uuid, m.user_id))
    ORDER BY coalesce(p.full_name, p.username) LIMIT 1000`));
  const [st] = Array.from(await db.execute<{ reports: Record<string, string> | null }>(sql`SELECT org_settings->'staffGrowth'->'reportsTo' AS reports FROM workspaces WHERE id = ${orgId}::uuid`));
  const people: LabPerson[] = rows.map((r) => ({ supervisor: st?.reports?.[r.id] ?? null,
    id: r.id, name: r.name ?? r.username ?? "Someone", username: r.username, avatarUrl: r.avatar_url,
    role: r.role === "owner" ? "pi" : r.role === "admin" ? "researcher" : "member", ...readPosition(r.prefs),
    // The end date shows to the PI, Researchers and the person (Leaving is a state, layer 11).
    leavingOn: ctx.admin || r.id === ctx.userId ? ((r.prefs as { leaving?: LeavingRecord } | null)?.leaving?.end ?? null) : null,
    interests: Array.isArray(r.interests) ? (r.interests as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 5) : [],
    workspaces: (Array.isArray(r.workspaces) ? r.workspaces as LabPerson["workspaces"] : []).slice(0, 6),
  }));
  return { success: true as const, admin: ctx.admin, pi: ctx.userId === ctx.owner && !ctx.blocked, me: ctx.userId, positions: ctx.settings.positions, people };
}

/** The PI and Researchers set a person's position and start year (call 2): a label only, merged into view_prefs. */
export async function setLabPositionAction(orgId: string, userId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = positionSchema.safeParse(input);
  if (!ctx?.admin || !isLooseUuid(userId) || !parsed.success) return DENIED;
  if (parsed.data.position && !ctx.settings.positions.some((p) => p.id === parsed.data.position)) return { success: false, error: "Pick one of the lab’s positions." };
  const done = await db.execute(sql`
    UPDATE workspace_members SET view_prefs = coalesce(view_prefs, '{}'::jsonb) || jsonb_build_object('lab', coalesce(view_prefs->'lab', '{}'::jsonb) || ${JSON.stringify(parsed.data)}::jsonb)
    WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND role <> 'viewer' RETURNING user_id`);
  return Array.from(done).length ? { success: true } : DENIED;
}

/** The supervisor (the PI or a Researcher) for one person: Reports to under the hood, so Start here and the plans use it. */
export async function setLabSupervisorAction(orgId: string, userId: string, supervisorId: string | null): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx?.admin || !isLooseUuid(userId) || (supervisorId !== null && !isLooseUuid(supervisorId))) return DENIED;
  if (supervisorId === userId) return { success: false, error: "Pick someone else as the supervisor." };
  if (supervisorId && supervisorId !== ctx.owner && !(await stillLead(orgId, supervisorId))) return { success: false, error: "A supervisor is the PI or one of the lab’s Researchers." };
  const [inLab] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND role <> 'viewer'`));
  if (!inLab) return DENIED;
  await db.execute(supervisorId
    ? sql`UPDATE workspaces SET org_settings = jsonb_set(jsonb_set(coalesce(org_settings, '{}'::jsonb), '{staffGrowth}', coalesce(org_settings->'staffGrowth', '{}'::jsonb)), '{staffGrowth,reportsTo}',
        coalesce(org_settings->'staffGrowth'->'reportsTo', '{}'::jsonb) || jsonb_build_object(${userId}::text, ${supervisorId}::text)) WHERE id = ${orgId}::uuid`
    : sql`UPDATE workspaces SET org_settings = org_settings #- ${`{staffGrowth,reportsTo,${userId}}`}::text[] WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** The lab home (call 1): welcome, Reach the PI with office hours, and People · Projects counts. */
export async function readLabHomeAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  // The chosen Researcher while they still are one (not completed), else the PI; nobody the viewer is in a block with.
  const contactId = (await stillLead(orgId, ctx.settings.contactId)) ? ctx.settings.contactId! : ctx.owner;
  const [c] = Array.from(await db.execute<{ name: string | null; username: string | null; people: number; projects: number; blocked: boolean }>(sql`
    SELECT (SELECT p.full_name FROM profiles p WHERE p.id = ${contactId}::uuid AND p.deleted_at IS NULL) AS name,
      (SELECT p.username FROM profiles p WHERE p.id = ${contactId}::uuid AND p.deleted_at IS NULL) AS username,
      (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer') AS people,
      (SELECT count(*)::int FROM workspaces c WHERE c.parent_id = ${orgId}::uuid AND c.deleted_at IS NULL AND c.status <> 'archived') AS projects,
      app_private.blocked_between(${ctx.userId}::uuid, ${contactId}::uuid) AS blocked`));
  const showContact = c && !c.blocked && (c.name || c.username) && contactId !== ctx.userId;
  return { success: true as const, admin: ctx.admin, welcome: ctx.description, officeHours: ctx.settings.officeHours || null,
    contact: showContact ? { id: contactId, name: c.name ?? c.username ?? "the PI" } : null, people: c?.people ?? 0, projects: c?.projects ?? 0 };
}

/** Settings → Lab (PI and Researchers). */
export async function readLabSettingsAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx?.admin) return DENIED;
  const leads = Array.from(await db.execute<{ id: string; name: string | null; username: string | null }>(sql`
    SELECT p.id, p.full_name AS name, p.username FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role IN ('owner', 'admin') AND m.completed_at IS NULL ORDER BY coalesce(p.full_name, p.username) LIMIT 50`));
  const settings = leads.some((l) => l.id === ctx.settings.contactId) ? ctx.settings : { ...ctx.settings, contactId: null };
  return { success: true as const, settings, owner: ctx.owner, leads: leads.map((l) => ({ id: l.id, name: l.name ?? l.username ?? "Someone" })) };
}

export async function saveLabSettingsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx?.admin) return DENIED;
  const parsed = labSettingsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Check the lab settings: up to 12 positions, each named." };
  const d = parsed.data;
  if (new Set(d.positions.map((p) => p.id)).size !== d.positions.length) return { success: false, error: "Check the lab settings: up to 12 positions, each named." };
  if (looksLikeContact(d.officeHours)) return { success: false, error: "Office hours is a time and place, not an email or phone number." };
  if (d.contactId && d.contactId !== ctx.owner && !(await stillLead(orgId, d.contactId))) return { success: false, error: "Reach the PI goes to the PI or one of the lab’s Researchers." };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('lab', ${JSON.stringify(d)}::jsonb), updated_at = now() WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/**
 * Finish in the lab (B6.1c, layer 5): the PI or a Researcher starts it for anyone but the PI, or a person for
 * themselves (never keeping themselves as Viewer). With the Leaving plan on, its steps become tasks for the person
 * and their supervisor, due before the end date; the membership ends on that date (finishDueLabMembers).
 */
export async function startFinishAction(orgId: string, userId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = finishSchema.safeParse(input);
  if (!ctx || ctx.blocked || !isLooseUuid(userId) || !parsed.success) return DENIED;
  const self = userId === ctx.userId;
  if (!ctx.admin && !self) return DENIED;
  if (userId === ctx.owner) return { success: false, error: "The PI transfers the lab before finishing in it." };
  // Review: finishing ends a membership, so like removal a Researcher can't finish another Researcher; the PI can.
  if (!self && ctx.userId !== ctx.owner && (await targetIsResearcher(orgId, userId))) return DENIED;
  const today = new Date().toISOString().slice(0, 10);
  const { end, keepAsViewer } = parsed.data;
  if (end < today || end > new Date(Date.now() + 366 * 864e5).toISOString().slice(0, 10)) return { success: false, error: "Pick an end date from today to a year ahead." };
  // Review: only the PI keeps someone as Viewer, and never themselves (call 6).
  if (keepAsViewer && (self || ctx.userId !== ctx.owner)) return DENIED;
  const { makeStepTask } = await import("@/lib/organizations/company-onboarding-server");
  const result = await db.transaction(async (tx) => {
    const [m] = Array.from(await tx.execute<{ prefs: Record<string, unknown> | null; name: string | null; reports: string | null }>(sql`
      SELECT m.view_prefs AS prefs, coalesce(p.full_name, p.username) AS name, w.org_settings->'staffGrowth'->'reportsTo'->>${userId}::text AS reports
      FROM workspace_members m JOIN profiles p ON p.id = m.user_id JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = ${userId}::uuid AND m.role <> 'viewer' FOR UPDATE OF m`));
    if (!m) return { error: DENIED.error };
    if (m.prefs?.leaving) return { error: "A Leaving plan is already open for them." };
    const supervisor = m.reports && (await stillLead(orgId, m.reports)) ? m.reports : ctx.owner;
    const steps: LeavingRecord["steps"] = [];
    for (const step of ctx.settings.plans.leaving ? LEAVING_PLAN : []) {
      const assignee = step.who === "person" ? userId : supervisor;
      const due = leavingDue(end, step.day, today);
      const taskId = await makeStepTask(tx as never, orgId, { id: step.id, day: 0, who: "person", kind: "do", title: step.title, required: true }, assignee, due, m.name ?? "them", ctx.userId, "Leaving plan");
      steps.push({ id: step.id, taskId });
    }
    const record: LeavingRecord = { end, keepAsViewer, by: ctx.userId, steps };
    await tx.execute(sql`UPDATE workspace_members SET view_prefs = coalesce(view_prefs, '{}'::jsonb) || jsonb_build_object('leaving', ${JSON.stringify(record)}::jsonb)
      WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid`);
    return { supervisor, name: m.name ?? "Someone" };
  });
  if ("error" in result) return { success: false, error: result.error! };
  const { createNotification } = await import("@/lib/notifications/service");
  for (const to of [...new Set([userId, result.supervisor])].filter((x) => x !== ctx.userId)) {
    await createNotification({ recipientUserId: to, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
      title: to === userId ? `Your Leaving plan has started: you finish on ${end}` : `${result.name} finishes on ${end}: Leaving plan started`,
      href: `/org/${encodeURIComponent(orgId)}?tab=members`, entityRefs: { projectId: orgId }, dedupeKey: `lab-leaving:${orgId}:${userId}:${end}` }).catch(() => undefined);
  }
  return { success: true };
}

/** Cancel a Leaving plan (the PI, a Researcher or the person): its open steps go away; done ones stay done. */
export async function cancelFinishAction(orgId: string, userId: string): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx || ctx.blocked || !isLooseUuid(userId) || (!ctx.admin && userId !== ctx.userId)) return DENIED;
  // The PI or a Researcher cancels any plan; a person cancels only one they started themselves (review).
  const m = await db.transaction(async (tx) => {
    const [row] = Array.from(await tx.execute<{ leaving: LeavingRecord | null }>(sql`
      SELECT view_prefs->'leaving' AS leaving FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`));
    if (!row?.leaving || (!ctx.admin && row.leaving.by !== ctx.userId)) return null;
    if (userId !== ctx.userId && ctx.userId !== ctx.owner && row.leaving.by !== ctx.userId && (await targetIsResearcher(orgId, userId))) return null;
    await tx.execute(sql`UPDATE workspace_members SET view_prefs = view_prefs - 'leaving' WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid`);
    return row;
  });
  if (!m?.leaving) return DENIED;
  const ids = m.leaving.steps.map((s) => s.taskId).filter((x): x is string => Boolean(x));
  if (ids.length) await db.execute(sql`UPDATE tasks SET deleted_at = now() WHERE workspace_id = ${orgId}::uuid AND status <> 'done' AND id = ANY(${`{${ids.join(",")}}`}::uuid[])`);
  return { success: true };
}

/** Members → Alumni (members): listed alumni only — position and years, Now at in their words (call 5). */
export async function readLabAlumniAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; name: string | null; username: string | null; position: string | null; start: number | null; end: number; now_at: string | null }>(sql`
    SELECT p.id, p.full_name AS name, p.username, a.position_label AS position, a.start_year AS start, a.end_year AS end, a.now_at
    FROM lab_alumni a JOIN profiles p ON p.id = a.user_id
    WHERE a.workspace_id = ${orgId}::uuid AND a.listed AND p.deleted_at IS NULL AND NOT app_private.blocked_between(${ctx.userId}::uuid, a.user_id) AND ${alumniStill}
    ORDER BY a.end_year DESC, coalesce(p.full_name, p.username) LIMIT 500`));
  return { success: true as const, alumni: rows.map((r) => ({ id: r.id, name: r.name ?? r.username ?? "Someone", position: r.position, startYear: r.start, endYear: r.end, nowAt: r.now_at })) };
}

async function myAlumni(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const [a] = Array.from(await db.execute<{ listed: boolean; now_at: string | null; position: string | null; start: number | null; end: number; frozen: boolean }>(sql`
    SELECT a.listed, a.now_at, a.position_label AS position, a.start_year AS start, a.end_year AS end, (w.suspended_at IS NOT NULL OR w.status = 'archived' OR w.deletion_scheduled_at IS NOT NULL) AS frozen
    FROM lab_alumni a JOIN workspaces w ON w.id = a.workspace_id
    WHERE a.workspace_id = ${orgId}::uuid AND a.user_id = ${userId}::uuid AND w.deleted_at IS NULL AND ${alumniStill}`));
  return a ? { userId, ...a } : null;
}

/** Your own alumni entry (only someone who finished here): List me as alumni, and Now at in your words. */
export async function readMyAlumniAction(orgId: string) {
  const a = await myAlumni(orgId);
  return a ? { success: true as const, entry: { listed: a.listed, nowAt: a.now_at ?? "", position: a.position, startYear: a.start, endYear: a.end } } : { success: true as const, entry: null };
}

export async function saveMyAlumniAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const a = await myAlumni(orgId);
  const parsed = alumniSchema.safeParse(input);
  if (!a || a.frozen || !parsed.success) return DENIED;
  if (looksLikeContact(parsed.data.nowAt)) return { success: false, error: "Now at is a place, not an email or phone number." };
  await db.execute(sql`UPDATE lab_alumni SET listed = ${parsed.data.listed}, now_at = ${parsed.data.nowAt || null}, updated_at = now() WHERE workspace_id = ${orgId}::uuid AND user_id = ${a.userId}::uuid`);
  return { success: true };
}

/**
 * The lab's public page (About, call 1): the sections the PI turned on. People and alumni appear only with a public
 * profile that shows this lab; alumni only with their own yes. No email or phone anywhere (call 7).
 */
export async function readLabAboutAction(orgId: string) {
  if (!isLooseUuid(orgId)) return DENIED;
  const { userId } = await getViewerAuthContext();
  const a = await getWorkspaceAccessById(orgId, userId ?? null);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; owner: string }>(sql`
    SELECT org_type AS type, org_settings AS settings, owner_id AS owner FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "research" || !a.canRead) return DENIED;
  const s = readLabSettings(w.settings);
  const inside = a.isOwner || (a.isMember && a.memberRole !== "viewer");
  const publicOnly = inside ? sql`TRUE` : sql`p.visibility = 'public' AND m.show_on_profile`;
  const people = s.about.people ? Array.from(await db.execute<{ id: string; name: string | null; username: string | null; prefs: unknown }>(sql`
    SELECT p.id, p.full_name AS name, p.username, m.view_prefs AS prefs FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND p.deleted_at IS NULL AND ${publicOnly}
      AND (${userId ?? null}::uuid IS NULL OR NOT app_private.blocked_between(${userId ?? null}::uuid, m.user_id))
    ORDER BY coalesce(p.full_name, p.username) LIMIT 300`)) : [];
  const alumni = s.about.alumni ? Array.from(await db.execute<{ id: string; name: string | null; username: string | null; position: string | null; start: number | null; end: number; now_at: string | null }>(sql`
    SELECT p.id, p.full_name AS name, p.username, a.position_label AS position, a.start_year AS start, a.end_year AS end, a.now_at
    FROM lab_alumni a JOIN profiles p ON p.id = a.user_id
    WHERE a.workspace_id = ${orgId}::uuid AND a.listed AND p.deleted_at IS NULL AND (${inside} OR p.visibility = 'public') AND ${alumniStill}
      AND (${userId ?? null}::uuid IS NULL OR NOT app_private.blocked_between(${userId ?? null}::uuid, a.user_id))
    ORDER BY a.end_year DESC LIMIT 200`)) : [];
  const positions = s.positions;
  return { success: true as const, signedIn: Boolean(userId), contactId: (await stillLead(orgId, s.contactId)) ? s.contactId! : w.owner,
    areas: s.about.areas ? s.researchAreas : [], joinUs: s.about.joinUs ? s.joinUs || null : null,
    people: people.map((p) => { const pos = readPosition(p.prefs); return { id: p.id, name: p.name ?? p.username ?? "Someone", position: pos.position, startYear: pos.startYear }; }),
    positions, showPeople: s.about.people, showAlumni: s.about.alumni,
    alumni: alumni.map((r) => ({ id: r.id, name: r.name ?? r.username ?? "Someone", position: r.position, startYear: r.start, endYear: r.end, nowAt: r.now_at })) };
}
