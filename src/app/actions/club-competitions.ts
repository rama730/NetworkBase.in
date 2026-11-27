"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { competitionSchema, NOT_THIS_TIME, type CompetitionTeam } from "@/lib/organizations/club";
import { notifyAll } from "@/lib/organizations/club-server";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";
import { statusForStage } from "@/lib/workflows/rules";
import { WORKFLOW_TYPES } from "@/lib/workflows/types";

/**
 * Report 36.5 (plan B7.4a, L4 calls 1–3, 5): the competitions a club enters. Officers add one with how teams are picked:
 * Open sign-up (members say Interested), Tryouts (a hand-in only the person and officers read) or Picked by officers.
 * Officers mark Selected or Not this time — told only to the person — and the person accepts their place. Officers then
 * make each team a private workspace under the club with a captain, roles and substitutes, so two teams in one competition
 * never see each other's work. No leaderboards: a placing is only that competition's result (B7.4b).
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
type Fields = z.infer<typeof competitionSchema> & { teams: CompetitionTeam[] };

async function club(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; slug: string | null; title: string }>(sql`
    SELECT org_type AS type, slug, title FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "club" || !a.canRead || !(a.isOwner || a.isMember)) return null;
  return { userId, w, officer: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, member: !a.writeBlocked && (a.isOwner || a.memberRole !== "viewer") };
}

async function competition(orgId: string, id: string, lock = false) {
  if (!isLooseUuid(id)) return null;
  const [c] = Array.from(await db.execute<{ id: string; title: string; stage: string; fields: Fields }>(sql`
    SELECT id, title, stage, type_fields AS fields FROM tasks WHERE id = ${id}::uuid AND workspace_id = ${orgId}::uuid AND item_type = 'competition' AND deleted_at IS NULL ${lock ? sql`FOR UPDATE` : sql``}`));
  return c ?? null;
}

/** Competitions (members): Upcoming or Past entries, with teams (name, captain, size) and my own place; officers get counts. */
export async function readCompetitionsAction(orgId: string, view: "upcoming" | "past" = "upcoming") {
  const ctx = await club(orgId);
  if (!ctx) return DENIED;
  const done = sql`t.stage IN ('results', 'withdrawn')`;
  const rows = Array.from(await db.execute<{ id: string; title: string; stage: string; fields: Fields }>(sql`
    SELECT t.id, t.title, t.stage, t.type_fields AS fields FROM tasks t WHERE t.workspace_id = ${orgId}::uuid AND t.item_type = 'competition' AND t.deleted_at IS NULL
      AND ${view === "past" ? done : sql`NOT (${done})`} ORDER BY t.type_fields->>'starts' ${view === "past" ? sql`DESC` : sql`ASC`} LIMIT 100`));
  const ids = rows.map((r) => r.id);
  const people = ids.length ? Array.from(await db.execute<{ competition_id: string; user_id: string | null; state: string; team: string | null; role: string | null; substitute: boolean }>(sql`
    SELECT competition_id, user_id, state, team_workspace_id AS team, role, substitute FROM club_competition_people WHERE competition_id = ANY(${`{${ids.join(",")}}`}::uuid[])`)) : [];
  const teamIds = rows.flatMap((r) => (r.fields.teams ?? []).map((t) => t.workspaceId));
  const captains = teamIds.length ? Array.from(await db.execute<{ id: string; slug: string | null; captain: string | null }>(sql`
    SELECT w.id, w.slug, coalesce(p.full_name, p.username) AS captain FROM workspaces w LEFT JOIN profiles p ON p.id = w.owner_id WHERE w.id = ANY(${`{${teamIds.join(",")}}`}::uuid[]) AND w.deleted_at IS NULL`)) : [];
  return { success: true as const, officer: ctx.officer, member: ctx.member, competitions: rows.map((r) => {
    const mine = people.find((p) => p.competition_id === r.id && p.user_id === ctx.userId);
    const of = people.filter((p) => p.competition_id === r.id);
    const { teams = [], ...details } = r.fields;
    return { id: r.id, title: r.title, stage: r.stage, ...details,
      teams: teams.filter((t) => captains.some((c) => c.id === t.workspaceId)).map((t) => ({ ...t, captain: captains.find((c) => c.id === t.workspaceId)?.captain ?? null,
        slug: ctx.officer || mine?.team === t.workspaceId ? captains.find((c) => c.id === t.workspaceId)?.slug ?? t.workspaceId : null,
        size: of.filter((p) => p.team === t.workspaceId && !p.substitute).length, subs: of.filter((p) => p.team === t.workspaceId && p.substitute).length,
        mine: mine?.team === t.workspaceId })),
      mine: mine ? { state: mine.state, role: mine.role } : null,
      counts: ctx.officer ? { interested: of.filter((p) => p.state === "interested" || p.state === "trying").length, accepted: of.filter((p) => p.state === "accepted").length } : null };
  }) };
}

/** Add or edit a competition (officers). A new one starts Planned. */
export async function saveCompetitionAction(orgId: string, id: string | null, input: unknown): Promise<{ success: true; id: string } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.officer) return DENIED;
  const parsed = competitionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Give the competition a name, dates (ending on or after the start) and a team size; links start with https://." };
  const d = parsed.data;
  if (id) {
    const c = await competition(orgId, id);
    if (!c) return DENIED;
    await db.execute(sql`UPDATE tasks SET title = ${d.title}, type_fields = ${JSON.stringify({ ...d, teams: c.fields.teams ?? [] })}::jsonb, updated_at = now() WHERE id = ${id}::uuid`);
    return { success: true, id };
  }
  const { insertTask } = await import("@/lib/organizations/assignments");
  const made = await db.transaction(async (tx) => {
    const tid = await insertTask(tx as never, { projectId: orgId, title: d.title, description: null, dueDate: null, sprintId: null, assigneeId: null, creatorId: ctx.userId,
      kind: "task", assignmentId: null, assignmentSettings: null, teamName: null });
    await tx.execute(sql`UPDATE tasks SET item_type = 'competition', stage = 'planned', status = ${statusForStage("competition", "planned")}, on_board = false,
      type_fields = ${JSON.stringify({ ...d, teams: [] })}::jsonb WHERE id = ${tid}::uuid`);
    return tid;
  });
  return { success: true, id: made };
}

/** Move a competition along (officers): Planned → Picking teams → Preparing → Registered → Competing → Results, or Withdrawn. */
export async function setCompetitionStageAction(orgId: string, id: string, stage: string): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.officer || !WORKFLOW_TYPES.competition!.stages.some((s) => s.key === stage)) return DENIED;
  const c = await competition(orgId, id);
  if (!c) return DENIED;
  await db.execute(sql`UPDATE tasks SET stage = ${stage}, status = ${statusForStage("competition", stage)}, updated_at = now() WHERE id = ${id}::uuid`);
  if (stage === "picking" && c.stage !== "picking") {
    const members = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role <> 'viewer' AND completed_at IS NULL LIMIT 2000`));
    const how = c.fields.picking === "tryouts" ? "Try out" : c.fields.picking === "open" ? "Sign up" : "Officers pick the teams";
    await notifyAll(orgId, ctx.w.slug ?? orgId, members.map((m) => ({ to: m.id, title: `${c.title}: ${how}` })), ctx.userId, `club-competition-picking:${id}`);
  }
  return { success: true };
}

/** Sign up (Open sign-up: Interested) or try out (Tryouts: with a hand-in only officers read), while teams are being picked. */
export async function signUpAction(orgId: string, id: string, input: { wish?: string; handIn?: string }): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.member) return DENIED;
  const c = await competition(orgId, id);
  if (!c || c.stage !== "picking" || c.fields.picking === "officers") return { success: false, error: "Sign-up for this competition isn’t open." };
  const wish = typeof input?.wish === "string" ? input.wish.trim().slice(0, 60) : "";
  const handIn = typeof input?.handIn === "string" ? input.handIn.trim() : "";
  if (c.fields.picking === "tryouts" && !handIn) return { success: false, error: "A tryout needs your hand-in." };
  if (handIn.length > 2000) return DENIED;
  const state = c.fields.picking === "tryouts" ? "trying" : "interested";
  const done = Array.from(await db.execute(sql`
    INSERT INTO club_competition_people (org_id, competition_id, user_id, name, wish, hand_in, state)
    SELECT ${orgId}::uuid, ${id}::uuid, p.id, coalesce(p.full_name, p.username, 'Member'), ${wish || null}, ${handIn || null}, ${state} FROM profiles p WHERE p.id = ${ctx.userId}::uuid
    ON CONFLICT (competition_id, user_id) DO UPDATE SET wish = EXCLUDED.wish, hand_in = EXCLUDED.hand_in
      WHERE club_competition_people.state IN ('interested', 'trying') RETURNING id`));
  if (!done.length) return { success: false, error: "You already have an answer for this competition." };
  return { success: true };
}

/** Picking (officers): everyone who signed up or tried out, with what they'd like to do and their hand-in. */
export async function readPickingAction(orgId: string, id: string) {
  const ctx = await club(orgId);
  if (!ctx?.officer) return DENIED;
  const c = await competition(orgId, id);
  if (!c) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; user_id: string | null; name: string; wish: string | null; hand_in: string | null; state: string; team: string | null; role: string | null; substitute: boolean }>(sql`
    SELECT id, user_id, name, wish, hand_in, state, team_workspace_id AS team, role, substitute FROM club_competition_people WHERE competition_id = ${id}::uuid ORDER BY created_at LIMIT 500`));
  const members = Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 500`));
  return { success: true as const, picking: c.fields.picking, teamSize: c.fields.teamSize, subs: c.fields.subs, members,
    people: rows.map((r) => ({ id: r.id, userId: r.user_id, name: r.name, wish: r.wish, handIn: r.hand_in, state: r.state, team: r.team, role: r.role, substitute: r.substitute })) };
}

/** Selected or Not this time (officers). Only the person is told, with the kind line for Not this time and nothing more. */
export async function decidePlaceAction(orgId: string, rowId: string, selected: boolean): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.officer || !isLooseUuid(rowId) || typeof selected !== "boolean") return DENIED;
  const [r] = Array.from(await db.execute<{ user_id: string | null; title: string }>(sql`
    UPDATE club_competition_people p SET state = ${selected ? "selected" : "not_this_time"}, decided_by = ${ctx.userId}::uuid, decided_at = now() FROM tasks t
    WHERE p.id = ${rowId}::uuid AND p.org_id = ${orgId}::uuid AND p.state IN ('interested', 'trying') AND t.id = p.competition_id RETURNING p.user_id, t.title`));
  if (!r) return DENIED;
  if (r.user_id) await notifyAll(orgId, ctx.w.slug ?? orgId, [{ to: r.user_id, title: selected ? `You’re selected for ${r.title}: accept your place` : `${r.title}: ${NOT_THIS_TIME}` }], ctx.userId, `club-competition-decided:${rowId}`);
  return { success: true };
}

/** Offer a place directly (officers; for Picked by officers, or anyone else). The person accepts it. */
export async function offerPlaceAction(orgId: string, id: string, userId: string): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.officer || !isLooseUuid(userId)) return DENIED;
  const c = await competition(orgId, id);
  if (!c || c.stage === "results" || c.stage === "withdrawn") return DENIED;
  const made = Array.from(await db.execute(sql`
    INSERT INTO club_competition_people (org_id, competition_id, user_id, name, state, decided_by, decided_at)
    SELECT ${orgId}::uuid, ${id}::uuid, p.id, coalesce(p.full_name, p.username, 'Member'), 'selected', ${ctx.userId}::uuid, now() FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = ${userId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL
    ON CONFLICT (competition_id, user_id) DO NOTHING RETURNING id`));
  if (!made.length) return { success: false, error: "They already have a place or an answer here." };
  await notifyAll(orgId, ctx.w.slug ?? orgId, [{ to: userId, title: `You’re offered a place for ${c.title}: accept it` }], ctx.userId, `club-competition-offer:${id}:${userId}`);
  return { success: true };
}

/** Accept or decline my place. Declining frees it for the next person the officers choose. */
export async function answerPlaceAction(orgId: string, id: string, accept: boolean): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.member || !isLooseUuid(id) || typeof accept !== "boolean") return DENIED;
  const done = Array.from(await db.execute(sql`UPDATE club_competition_people SET state = ${accept ? "accepted" : "declined"} WHERE competition_id = ${id}::uuid AND org_id = ${orgId}::uuid
    AND user_id = ${ctx.userId}::uuid AND state = 'selected' RETURNING id`));
  return done.length ? { success: true } : DENIED;
}

const teamSchema = z.object({ name: z.string().trim().min(1).max(40), captainId: z.string().uuid(),
  people: z.array(z.object({ userId: z.string().uuid(), role: z.string().trim().max(60), substitute: z.boolean() }).strict()).min(1).max(40) }).strict();

/**
 * Make a team (officers): a private workspace under the club, with the captain as its lead and the people who accepted a
 * place as members, each with a role (driver, programmer, speaker 1) or as a substitute.
 */
export async function makeTeamAction(orgId: string, id: string, input: unknown): Promise<{ success: true; workspaceId: string; slug: string } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.officer) return DENIED;
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Name the team, pick its captain and its people." };
  const d = parsed.data;
  const c = await competition(orgId, id);
  if (!c || c.stage === "results" || c.stage === "withdrawn") return DENIED;
  const ids = [...new Set(d.people.map((p) => p.userId))];
  if (ids.length !== d.people.length || !ids.includes(d.captainId)) return { success: false, error: "The captain is one of the team, and each person is on it once." };
  const subs = d.people.filter((p) => p.substitute).length;
  if (d.people.length - subs > c.fields.teamSize || subs > c.fields.subs) return { success: false, error: `A team here is up to ${c.fields.teamSize} people and ${c.fields.subs} substitutes.` };
  const ok = Array.from(await db.execute<{ user_id: string }>(sql`
    SELECT user_id FROM club_competition_people WHERE competition_id = ${id}::uuid AND state = 'accepted' AND team_workspace_id IS NULL AND user_id = ANY(${`{${ids.join(",")}}`}::uuid[])`));
  if (ok.length !== ids.length) return { success: false, error: "Everyone on a team has accepted a place and isn’t on another team yet." };
  const { createWorkspaceAction } = await import("@/lib/workspaces/server/lifecycle");
  const made = await createWorkspaceAction({
    title: `${c.title} · ${d.name}`.slice(0, 100), description: `${d.name}, the club’s team for ${c.title}. The plan, roles, practice and resources live here.`,
    project_type: "other", custom_project_type: "Competition team", visibility: "private", status: "active", tags: [], technologies_used: [], lifecycle_stages: [], current_stage_index: 0,
    member_updates_enabled: true, member_file_upload_default: true, doc_edit_policy: "members", is_draft: false, metadata: {},
    readme: { mode: "skip", publishOnCreate: false, includeRoles: false }, parent_org_id: orgId, lead_user_id: d.captainId,
    unassigned_people: ids.filter((u) => u !== d.captainId).map((user_id) => ({ user_id })),
  } as Parameters<typeof createWorkspaceAction>[0]);
  if (!made.success || !("project" in made) || !made.project) return { success: false, error: "error" in made && made.error ? made.error : "Couldn’t make the team workspace." };
  const ws = made.project.id;
  await db.transaction(async (tx) => {
    for (const p of d.people) await tx.execute(sql`UPDATE club_competition_people SET team_workspace_id = ${ws}::uuid, role = ${p.role || null}, substitute = ${p.substitute}
      WHERE competition_id = ${id}::uuid AND user_id = ${p.userId}::uuid AND state = 'accepted'`);
    await tx.execute(sql`UPDATE tasks SET type_fields = jsonb_set(type_fields, '{teams}', coalesce(type_fields->'teams', '[]'::jsonb) || ${JSON.stringify([{ workspaceId: ws, name: d.name }])}::jsonb) WHERE id = ${id}::uuid`);
  });
  // The team's page: one-liner, problem, approach, roles and resources (36.5 call 2).
  const roles = d.people.map((p) => `- ${p.substitute ? "Substitute" : p.role || "Member"}${p.userId === d.captainId ? " (captain)" : ""}`).join("\n");
  const { applyCreationIntentAction } = await import("@/app/actions/workspace/doc");
  await applyCreationIntentAction(ws, { mode: "starter", publishOnCreate: true, includeRoles: false,
    starterContent: `# ${d.name} · ${c.title}\n\n## One-liner\n\n_What we’re building or arguing, in a sentence._\n\n## Problem\n\n## Our approach\n\n## Roles\n\n${roles}\n\n## Resources\n\n${c.fields.link ? `- Competition page: ${c.fields.link}\n` : ""}` }).catch(() => undefined);
  return { success: true, workspaceId: ws, slug: made.project.slug };
}
