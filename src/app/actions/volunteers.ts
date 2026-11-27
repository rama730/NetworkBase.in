"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { checkInOpen, coordinatorCheckIn, isShort, readVolunteers, shiftHours, shiftSchema, volunteersFor, volunteersSchema, type ShiftFields } from "@/lib/organizations/volunteers";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 37.3 (plan B8.1a, X2): volunteers and shifts for an Other organization with Volunteers on. Coordinators (owner
 * and admins) set roles, the volunteer agreement and shifts, sign off trainings, check people in and see coverage and
 * counts; volunteers (members) agree, sign up (the RSVP slice: places and a waitlist that moves up), check in inside the
 * window and see only their own hours. Visitors see Volunteer with us. No scores; contact is Message only.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
type Prefs = { agreed?: number; trained?: string[] };

async function org(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; slug: string | null; title: string; prefs: Prefs | null }>(sql`
    SELECT w.org_type AS type, w.org_settings AS settings, w.slug, w.title,
      (SELECT m.view_prefs->'volunteer' FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid AND m.completed_at IS NULL) AS prefs
    FROM workspaces w WHERE w.id = ${orgId}::uuid AND w.kind = 'organization' AND w.deleted_at IS NULL`));
  if (!w || !volunteersFor(w.type) || !a.canRead) return null;
  const settings = readVolunteers(w.settings);
  return { userId, w, settings, slug: w.slug ?? orgId, prefs: w.prefs ?? {},
    coordinator: Boolean(userId) && (a.isOwner || a.memberRole === "admin") && !a.writeBlocked,
    member: Boolean(userId) && (a.isOwner || (a.isMember && a.memberRole !== "viewer")) && !a.writeBlocked };
}

type ShiftRow = { id: string; stage: string; fields: ShiftFields; places: number; going: number; waitlisted: number; mine: string | null; checked: boolean };
async function shifts(orgId: string, userId: string | null, where: ReturnType<typeof sql>) {
  return Array.from(await db.execute<ShiftRow>(sql`
    SELECT t.id, t.stage, t.type_fields AS fields, e.place_limit AS places,
      (SELECT count(*)::int FROM community_rsvps r WHERE r.task_id = t.id AND r.state = 'going') AS going,
      (SELECT count(*)::int FROM community_rsvps r WHERE r.task_id = t.id AND r.state = 'waitlisted') AS waitlisted,
      (SELECT r.state FROM community_rsvps r WHERE r.task_id = t.id AND r.user_id = ${userId}::uuid) AS mine,
      coalesce((SELECT r.checked_in_at IS NOT NULL FROM community_rsvps r WHERE r.task_id = t.id AND r.user_id = ${userId}::uuid), false) AS checked
    FROM tasks t JOIN community_events e ON e.task_id = t.id
    WHERE t.workspace_id = ${orgId}::uuid AND t.item_type = 'event' AND t.type_fields->>'kind' = 'shift' AND t.deleted_at IS NULL AND ${where}
    ORDER BY t.type_fields->>'start' LIMIT 300`));
}

/** Volunteers (members and coordinators): roles, the agreement, the next 30 days of shifts, my hours; coordinators also coverage and people. */
export async function readVolunteersAction(orgId: string) {
  const ctx = await org(orgId);
  if (!ctx || !(ctx.member || ctx.coordinator)) return DENIED;
  const s = ctx.settings;
  if (!s.on && !ctx.coordinator) return { success: true as const, on: false, coordinator: false } as const;
  const now = Date.now();
  const rows = await shifts(orgId, ctx.userId, sql`t.stage <> 'cancelled' AND (t.type_fields->>'end')::timestamptz > now() - interval '1 day' AND (t.type_fields->>'start')::timestamptz < now() + interval '30 days'`);
  const year = `${new Date().getUTCFullYear()}-01-01`;
  const done = await shifts(orgId, ctx.userId, sql`EXISTS (SELECT 1 FROM community_rsvps r WHERE r.task_id = t.id AND r.user_id = ${ctx.userId}::uuid AND r.checked_in_at IS NOT NULL) AND (t.type_fields->>'start')::timestamptz >= ${year}::timestamptz`);
  const trained = new Set(ctx.prefs.trained ?? []);
  const roleOf = (id: string) => s.roles.find((r) => r.id === id) ?? null;
  const shaped = rows.map((r) => ({ id: r.id, role: roleOf(r.fields.roleId)?.name ?? "Volunteer", roleId: r.fields.roleId, place: r.fields.place, note: r.fields.note, start: r.fields.start, end: r.fields.end,
    places: r.places, going: r.going, waitlisted: r.waitlisted, mine: r.mine as "going" | "waitlisted" | "cant_go" | null, checkedIn: r.checked,
    canCheckIn: r.mine === "going" && !r.checked && checkInOpen(r.fields.start, now), short: isShort(r.fields.start, r.going, r.places, now),
    needsTraining: Boolean(roleOf(r.fields.roleId)?.training) && !trained.has(r.fields.roleId), started: Date.parse(r.fields.start) <= now }));
  const base = { success: true as const, on: s.on, coordinator: ctx.coordinator, roles: s.roles, agreement: s.agreement, agreed: (ctx.prefs.agreed ?? -1) >= s.agreement.version,
    trained: [...trained], shifts: shaped, hours: { year: shiftHours(done.map((d) => d.fields)), shifts: done.length } };
  if (!ctx.coordinator) return { ...base, coverage: [], people: [] };
  // Coordinators: who volunteers, their trainings and attended / missed as counts — never a score, never shown to others.
  const people = Array.from(await db.execute<{ id: string; name: string; trained: string[] | null; attended: number; missed: number }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name, coalesce(m.view_prefs->'volunteer'->'trained', '[]'::jsonb) AS trained,
      (SELECT count(*)::int FROM community_rsvps r JOIN tasks t ON t.id = r.task_id WHERE r.user_id = m.user_id AND t.workspace_id = m.workspace_id AND t.type_fields->>'kind' = 'shift' AND r.checked_in_at IS NOT NULL) AS attended,
      (SELECT count(*)::int FROM community_rsvps r JOIN tasks t ON t.id = r.task_id WHERE r.user_id = m.user_id AND t.workspace_id = m.workspace_id AND t.type_fields->>'kind' = 'shift' AND t.stage <> 'cancelled'
        AND r.state = 'going' AND r.checked_in_at IS NULL AND (t.type_fields->>'end')::timestamptz < now()) AS missed
    FROM workspace_members m JOIN profiles p ON p.id = m.user_id WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 500`));
  return { ...base, coverage: shaped.filter((x) => x.short).sort((a, b) => a.start.localeCompare(b.start)), people: people.map((p) => ({ ...p, trained: p.trained ?? [] })) };
}

/** Settings → Volunteers (coordinators): on or off, roles (some need training), the agreement (a new text is a new version). */
export async function saveVolunteerSettingsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.coordinator) return DENIED;
  const parsed = volunteersSchema.safeParse(input);
  if (!parsed.success || new Set(parsed.data.roles.map((r) => r.id)).size !== parsed.data.roles.length) return { success: false, error: "Each role needs a name; up to 30." };
  const d = parsed.data;
  const version = d.agreement.text === ctx.settings.agreement.text ? ctx.settings.agreement.version : ctx.settings.agreement.version + 1;
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{volunteers}', ${JSON.stringify({ ...d, agreement: { text: d.agreement.text, version } })}::jsonb)
    WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** I agree to the current volunteer agreement (members). */
export async function agreeVolunteerAction(orgId: string, version: number): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || version !== ctx.settings.agreement.version) return DENIED;
  await db.execute(sql`UPDATE workspace_members SET view_prefs = jsonb_set(coalesce(view_prefs, '{}'::jsonb), '{volunteer}', coalesce(view_prefs->'volunteer', '{}'::jsonb) || jsonb_build_object('agreed', ${version}::int))
    WHERE workspace_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid`);
  return { success: true };
}

/** Sign off (or take back) a volunteer's training for a role (coordinators; R4's sign-off). */
export async function signOffTrainingAction(orgId: string, person: string, roleId: string, on: boolean): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.coordinator || !isLooseUuid(person) || !ctx.settings.roles.some((r) => r.id === roleId && r.training) || typeof on !== "boolean") return DENIED;
  const done = Array.from(await db.execute(sql`
    UPDATE workspace_members SET view_prefs = jsonb_set(coalesce(view_prefs, '{}'::jsonb), '{volunteer}', coalesce(view_prefs->'volunteer', '{}'::jsonb) || jsonb_build_object('trained',
      (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements_text(coalesce(view_prefs->'volunteer'->'trained', '[]'::jsonb) ${on ? sql`|| to_jsonb(${roleId}::text)` : sql``}) x WHERE ${on} OR x <> ${roleId})))
    WHERE workspace_id = ${orgId}::uuid AND user_id = ${person}::uuid AND role <> 'viewer' AND completed_at IS NULL RETURNING user_id`));
  return done.length ? { success: true } : DENIED;
}

/** Add a shift (coordinators): a role, place, time and places; sign-up uses the RSVP slice. */
export async function saveShiftAction(orgId: string, input: unknown): Promise<{ success: true; id: string } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.coordinator) return DENIED;
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Pick a role, a start and an end within a day, and how many places." };
  const { places, ...f } = parsed.data;
  if (!ctx.settings.roles.some((r) => r.id === f.roleId)) return { success: false, error: "Pick a role from Settings → Volunteers." };
  const { insertTask } = await import("@/lib/organizations/assignments");
  const { statusForStage } = await import("@/lib/workflows/rules");
  const fields: ShiftFields = { kind: "shift", ...f };
  const id = await db.transaction(async (tx) => {
    const tid = await insertTask(tx as never, { projectId: orgId, title: ctx.settings.roles.find((r) => r.id === f.roleId)!.name, description: f.note || null, dueDate: null, sprintId: null, assigneeId: null,
      creatorId: ctx.userId!, kind: "task", assignmentId: null, assignmentSettings: null, teamName: null });
    await tx.execute(sql`UPDATE tasks SET item_type = 'event', stage = 'confirmed', status = ${statusForStage("event", "confirmed")}, on_board = false, type_fields = ${JSON.stringify(fields)}::jsonb WHERE id = ${tid}::uuid`);
    await tx.execute(sql`INSERT INTO community_events (task_id, workspace_id, place_limit) VALUES (${tid}::uuid, ${orgId}::uuid, ${places})`);
    return tid;
  });
  return { success: true, id };
}

/** Promote the waitlist into free places, first come (under the shift's lock). */
async function promote(tx: Pick<typeof db, "execute">, shiftId: string) {
  const [s] = Array.from(await tx.execute<{ places: number; going: number }>(sql`
    SELECT e.place_limit AS places, (SELECT count(*)::int FROM community_rsvps r WHERE r.task_id = e.task_id AND r.state = 'going') AS going FROM community_events e WHERE e.task_id = ${shiftId}::uuid`));
  const free = Math.max(0, (s?.places ?? 0) - (s?.going ?? 0));
  if (!free) return [];
  return Array.from(await tx.execute<{ id: string }>(sql`
    UPDATE community_rsvps SET state = 'going', responded_at = now() WHERE task_id = ${shiftId}::uuid AND user_id IN (
      SELECT user_id FROM community_rsvps WHERE task_id = ${shiftId}::uuid AND state = 'waitlisted' ORDER BY responded_at LIMIT ${free}) RETURNING user_id AS id`));
}
const tell = (orgId: string, slug: string, to: string, title: string, key: string, importance: "important" | "more" = "important") =>
  createNotification({ recipientUserId: to, actorUserId: null, kind: "project_task_activity", category: "tasks", importance, title, href: `/org/${encodeURIComponent(slug)}`,
    entityRefs: { projectId: orgId, projectSlug: slug }, dedupeKey: key }).catch(() => undefined);

/**
 * Sign up or Can't go (volunteers). Needs the current agreement and, for a role that needs it, the training sign-off.
 * A full shift puts you on the waitlist; Can't go frees your place and the waitlist moves up (told: Important).
 */
export async function shiftSignUpAction(orgId: string, shiftId: string, choice: "going" | "cant_go"): Promise<{ success: true; state: "going" | "waitlisted" | "cant_go" } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !ctx.settings.on || !isLooseUuid(shiftId) || (choice !== "going" && choice !== "cant_go")) return DENIED;
  if (choice === "going" && (ctx.prefs.agreed ?? -1) < ctx.settings.agreement.version) return { success: false, error: "Agree to the volunteer agreement first." };
  const out = await db.transaction(async (tx) => {
    const [s] = Array.from(await tx.execute<{ fields: ShiftFields; stage: string; places: number }>(sql`
      SELECT t.type_fields AS fields, t.stage, e.place_limit AS places FROM tasks t JOIN community_events e ON e.task_id = t.id
      WHERE t.id = ${shiftId}::uuid AND t.workspace_id = ${orgId}::uuid AND t.item_type = 'event' AND t.type_fields->>'kind' = 'shift' AND t.deleted_at IS NULL FOR UPDATE OF e`));
    if (!s || s.stage === "cancelled" || Date.parse(s.fields.start) <= Date.now()) return "closed" as const;
    const role = ctx.settings.roles.find((r) => r.id === s.fields.roleId);
    if (choice === "going" && role?.training && !(ctx.prefs.trained ?? []).includes(role.id)) return "training" as const;
    const [{ going, waiting } = { going: 0, waiting: 0 }] = Array.from(await tx.execute<{ going: number; waiting: number }>(sql`
      SELECT count(*) FILTER (WHERE state = 'going')::int AS going, count(*) FILTER (WHERE state = 'waitlisted')::int AS waiting FROM community_rsvps WHERE task_id = ${shiftId}::uuid AND user_id <> ${ctx.userId}::uuid`));
    const [prev] = Array.from(await tx.execute<{ state: string }>(sql`SELECT state FROM community_rsvps WHERE task_id = ${shiftId}::uuid AND user_id = ${ctx.userId}::uuid`));
    const state: "going" | "waitlisted" | "cant_go" = choice === "cant_go" ? "cant_go" : prev?.state === "going" ? "going" : prev?.state === "waitlisted" ? "waitlisted" : waiting > 0 || going >= s.places ? "waitlisted" : "going";
    await tx.execute(sql`INSERT INTO community_rsvps (task_id, user_id, workspace_id, state) VALUES (${shiftId}::uuid, ${ctx.userId}::uuid, ${orgId}::uuid, ${state})
      ON CONFLICT (task_id, user_id) DO UPDATE SET state = excluded.state, responded_at = CASE WHEN community_rsvps.state = excluded.state THEN community_rsvps.responded_at ELSE now() END,
        checked_in_at = CASE WHEN excluded.state = 'going' THEN community_rsvps.checked_in_at ELSE NULL END`);
    return { state, moved: prev?.state === "going" && state === "cant_go" ? await promote(tx, shiftId) : [], role: role?.name ?? "a shift", start: s.fields.start };
  });
  if (out === "closed") return { success: false, error: "This shift isn’t taking sign-ups." };
  if (out === "training") return { success: false, error: "This role needs a training sign-off first." };
  for (const m of out.moved) await tell(orgId, ctx.slug, m.id, `A place opened: you’re on ${out.role} (${new Date(out.start).toUTCString().slice(0, 22)} UTC)`, `volunteer-moved-up:${shiftId}:${m.id}`);
  return { success: true, state: out.state };
}

/** Cancel a shift (coordinators): everyone going or waiting is told at once (Important). */
export async function cancelShiftAction(orgId: string, shiftId: string): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.coordinator || !isLooseUuid(shiftId)) return DENIED;
  const [s] = Array.from(await db.execute<{ title: string }>(sql`UPDATE tasks SET stage = 'cancelled', status = 'done', updated_at = now()
    WHERE id = ${shiftId}::uuid AND workspace_id = ${orgId}::uuid AND item_type = 'event' AND type_fields->>'kind' = 'shift' AND deleted_at IS NULL AND stage <> 'cancelled' RETURNING title`));
  if (!s) return DENIED;
  const people = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM community_rsvps WHERE task_id = ${shiftId}::uuid AND state IN ('going', 'waitlisted')`));
  for (const p of people) await tell(orgId, ctx.slug, p.id, `Shift cancelled: ${s.title}`, `volunteer-cancelled:${shiftId}:${p.id}`);
  return { success: true };
}

/** Check in: myself inside the window (15 minutes before to 30 after), or a coordinator ticks a name (an hour before to the day after). */
export async function checkInShiftAction(orgId: string, shiftId: string, person: string | null, on = true): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !isLooseUuid(shiftId) || (person !== null && !isLooseUuid(person)) || typeof on !== "boolean") return DENIED;
  const self = person === null || person === ctx.userId;
  if (!self && !ctx.coordinator) return DENIED;
  const [s] = Array.from(await db.execute<{ fields: ShiftFields; stage: string }>(sql`
    SELECT type_fields AS fields, stage FROM tasks WHERE id = ${shiftId}::uuid AND workspace_id = ${orgId}::uuid AND item_type = 'event' AND type_fields->>'kind' = 'shift' AND deleted_at IS NULL`));
  if (!s || s.stage === "cancelled") return DENIED;
  if (self && !ctx.coordinator ? !checkInOpen(s.fields.start) : !coordinatorCheckIn(s.fields.start, s.fields.end)) return { success: false, error: "Check-in isn’t open for this shift now." };
  const [r] = Array.from(await db.execute(sql`UPDATE community_rsvps SET checked_in_at = ${on ? sql`coalesce(checked_in_at, now())` : sql`NULL`}
    WHERE task_id = ${shiftId}::uuid AND user_id = ${self ? ctx.userId : person}::uuid AND state = 'going' RETURNING user_id`));
  return r ? { success: true } : { success: false, error: "Only people going can be checked in." };
}

/** A shift's going list (coordinators), to check people in. */
export async function readShiftPeopleAction(orgId: string, shiftId: string) {
  const ctx = await org(orgId);
  if (!ctx?.coordinator || !isLooseUuid(shiftId)) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; name: string; state: string; checked: boolean }>(sql`
    SELECT r.user_id AS id, coalesce(p.full_name, p.username, 'Member') AS name, r.state, r.checked_in_at IS NOT NULL AS checked
    FROM community_rsvps r JOIN tasks t ON t.id = r.task_id JOIN profiles p ON p.id = r.user_id
    WHERE r.task_id = ${shiftId}::uuid AND t.workspace_id = ${orgId}::uuid AND r.state IN ('going', 'waitlisted') ORDER BY r.state, r.responded_at`));
  return { success: true as const, people: rows };
}

/** Volunteer with us (About; anyone who can see the organization): upcoming open shifts with places left and training. */
export async function readVolunteerWithUsAction(orgId: string) {
  const ctx = await org(orgId);
  if (!ctx || !ctx.settings.on) return DENIED;
  const rows = await shifts(orgId, null, sql`t.stage <> 'cancelled' AND (t.type_fields->>'start')::timestamptz > now() AND (t.type_fields->>'start')::timestamptz < now() + interval '30 days'`);
  return { success: true as const, member: ctx.member, shifts: rows.slice(0, 20).map((r) => {
    const role = ctx.settings.roles.find((x) => x.id === r.fields.roleId);
    return { id: r.id, role: role?.name ?? "Volunteer", training: Boolean(role?.training), place: r.fields.place, start: r.fields.start, end: r.fields.end, places: r.places, left: Math.max(0, r.places - r.going) };
  }) };
}
