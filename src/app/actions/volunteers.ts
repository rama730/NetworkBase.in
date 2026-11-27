"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { checkInOpen, coordinatorCheckIn, isShort, readVolunteers, shiftHours, shiftSchema, volunteersFor, volunteersSchema, type ShiftFields } from "@/lib/organizations/volunteers";
import { partOn } from "@/lib/organizations/kits";
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
type Prefs = { agreed?: number; trained?: string[]; regular?: string[]; availability?: string };
/** The current agreement is accepted, or there is none to accept. */
const agreedTo = (s: { agreement: { text: string; version: number } }, p: Prefs) => !s.agreement.text || (p.agreed ?? -1) >= s.agreement.version;

async function org(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; slug: string | null; title: string; prefs: Prefs | null }>(sql`
    SELECT w.org_type AS type, w.org_settings AS settings, w.slug, w.title,
      (SELECT m.view_prefs->'volunteer' FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid AND m.completed_at IS NULL) AS prefs
    FROM workspaces w WHERE w.id = ${orgId}::uuid AND w.kind = 'organization' AND w.deleted_at IS NULL`));
  // B8.4a (37.2 call 5): Volunteers shows only while its part is on in Settings → Workflows (off keeps the data).
  if (!w || !volunteersFor(w.type) || !partOn(w.settings, "volunteers") || !a.canRead) return null;
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
  const hours = await hoursFor(orgId, ctx.userId!, new Date().getUTCFullYear());
  const trained = new Set(ctx.prefs.trained ?? []);
  const roleOf = (id: string) => s.roles.find((r) => r.id === id) ?? null;
  const shaped = rows.map((r) => ({ id: r.id, role: roleOf(r.fields.roleId)?.name ?? "Volunteer", roleId: r.fields.roleId, place: r.fields.place, note: r.fields.note, start: r.fields.start, end: r.fields.end,
    places: r.places, going: r.going, waitlisted: r.waitlisted, mine: r.mine as "going" | "waitlisted" | "cant_go" | null, checkedIn: r.checked,
    canCheckIn: r.mine === "going" && !r.checked && checkInOpen(r.fields.start, now), short: isShort(r.fields.start, r.going, r.places, now),
    needsTraining: Boolean(roleOf(r.fields.roleId)?.training) && !trained.has(r.fields.roleId), started: Date.parse(r.fields.start) <= now, series: r.fields.series ?? null }));
  // B8.1b: swaps I asked for or was asked, people I can ask, my Regular series and availability.
  const swaps = Array.from(await db.execute<{ id: string; shift_id: string; from_user: string; to_user: string; name: string }>(sql`
    SELECT s.id, s.shift_id, s.from_user, s.to_user, coalesce(p.full_name, p.username, 'Member') AS name FROM volunteer_swaps s
    JOIN profiles p ON p.id = CASE WHEN s.to_user = ${ctx.userId}::uuid THEN s.from_user ELSE s.to_user END
    WHERE s.org_id = ${orgId}::uuid AND s.state = 'asked' AND (s.from_user = ${ctx.userId}::uuid OR s.to_user = ${ctx.userId}::uuid) LIMIT 50`));
  const volunteers = Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL AND m.user_id <> ${ctx.userId}::uuid
      AND (${!s.agreement.text} OR coalesce((m.view_prefs->'volunteer'->>'agreed')::int, -1) >= ${s.agreement.version}) ORDER BY 2 LIMIT 300`));
  const base = { success: true as const, on: s.on, coordinator: ctx.coordinator, roles: s.roles, agreement: s.agreement, agreed: agreedTo(s, ctx.prefs),
    trained: [...trained], shifts: shaped, hours: { year: hours.confirmed, shifts: hours.shifts, waiting: hours.waiting },
    regular: ctx.prefs.regular ?? [], availability: ctx.prefs.availability ?? "", volunteers,
    swapsIn: swaps.filter((w) => w.to_user === ctx.userId).map((w) => ({ id: w.id, shiftId: w.shift_id, from: w.name })),
    swapsOut: swaps.filter((w) => w.from_user === ctx.userId).map((w) => ({ id: w.id, shiftId: w.shift_id, to: w.name })) };
  if (!ctx.coordinator) return { ...base, coverage: [], people: [], waitingHours: [], programs: [] };
  const programs = Array.from(await db.execute<{ id: string; title: string }>(sql`SELECT id, title FROM workspaces WHERE parent_id = ${orgId}::uuid AND deleted_at IS NULL AND org_settings ? 'program' ORDER BY title LIMIT 100`));
  // Coordinators: who volunteers, their trainings and attended / missed as counts — never a score, never shown to others.
  const people = Array.from(await db.execute<{ id: string; name: string; trained: string[] | null; attended: number; missed: number; availability: string | null; regular: boolean; joined: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name, coalesce(m.view_prefs->'volunteer'->'trained', '[]'::jsonb) AS trained,
      m.view_prefs->'volunteer'->>'availability' AS availability, jsonb_array_length(coalesce(m.view_prefs->'volunteer'->'regular', '[]'::jsonb)) > 0 AS regular, m.joined_at AS joined,
      (SELECT count(*)::int FROM community_rsvps r JOIN tasks t ON t.id = r.task_id WHERE r.user_id = m.user_id AND t.workspace_id = m.workspace_id AND t.type_fields->>'kind' = 'shift' AND r.checked_in_at IS NOT NULL) AS attended,
      (SELECT count(*)::int FROM community_rsvps r JOIN tasks t ON t.id = r.task_id WHERE r.user_id = m.user_id AND t.workspace_id = m.workspace_id AND t.type_fields->>'kind' = 'shift' AND t.stage <> 'cancelled'
        AND r.state = 'going' AND r.checked_in_at IS NULL AND (t.type_fields->>'end')::timestamptz < now()) AS missed
    FROM workspace_members m JOIN profiles p ON p.id = m.user_id WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 500`));
  const waitingHours = Array.from(await db.execute<{ id: string; name: string; day: string; hours: string; role_id: string | null; note: string }>(sql`
    SELECT h.id, coalesce(p.full_name, p.username, 'Member') AS name, h.day::text AS day, h.hours::text AS hours, h.role_id, h.note FROM volunteer_hours h JOIN profiles p ON p.id = h.user_id
    WHERE h.org_id = ${orgId}::uuid AND h.state = 'waiting' ORDER BY h.created_at LIMIT 100`));
  // Involvement (coordinators only, M2's status rule): Regular, New (joined in the last 30 days or not yet attended), else Occasional.
  const involvement = (p: { regular: boolean; joined: string; attended: number }) => p.regular ? "Regular" : now - Date.parse(p.joined) < 30 * 86_400_000 || p.attended === 0 ? "New" : "Occasional";
  return { ...base, coverage: shaped.filter((x) => x.short).sort((a, b) => a.start.localeCompare(b.start)),
    people: people.map(({ joined, regular, ...p }) => ({ ...p, trained: p.trained ?? [], availability: p.availability ?? "", involvement: involvement({ regular, joined: new Date(joined).toISOString(), attended: p.attended }) })),
    programs, waitingHours: waitingHours.map((h) => ({ id: h.id, name: h.name, day: h.day, hours: Number(h.hours), role: roleOf(h.role_id ?? "")?.name ?? null, note: h.note })) };
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

/**
 * Add a shift (coordinators): a role, place, time and places; sign-up uses the RSVP slice. B8.1b: it can repeat every
 * week for up to 12 more weeks (S1's repeat), as one series volunteers can be Regulars of.
 */
export async function saveShiftAction(orgId: string, input: unknown, repeatWeeks = 0): Promise<{ success: true; id: string } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.coordinator) return DENIED;
  const parsed = shiftSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Pick a role, a start and an end within a day, and how many places." };
  const { places, ...f } = parsed.data;
  if (!ctx.settings.roles.some((r) => r.id === f.roleId)) return { success: false, error: "Pick a role from Settings → Volunteers." };
  if (f.programId) {
    const [prog] = Array.from(await db.execute(sql`SELECT 1 FROM workspaces WHERE id = ${f.programId}::uuid AND parent_id = ${orgId}::uuid AND deleted_at IS NULL AND org_settings ? 'program'`));
    if (!prog) return DENIED;
  }
  const { insertTask } = await import("@/lib/organizations/assignments");
  const { statusForStage } = await import("@/lib/workflows/rules");
  const weeks = Number.isInteger(repeatWeeks) ? Math.max(0, Math.min(12, repeatWeeks)) : 0;
  const series = weeks ? crypto.randomUUID() : undefined;
  const WEEK = 7 * 86_400_000;
  const id = await db.transaction(async (tx) => {
    let first = "";
    for (let k = 0; k <= weeks; k++) {
      const fields: ShiftFields = { kind: "shift", ...f, start: new Date(Date.parse(f.start) + k * WEEK).toISOString(), end: new Date(Date.parse(f.end) + k * WEEK).toISOString(), ...(series ? { series } : {}) };
      const tid = await insertTask(tx as never, { projectId: orgId, title: ctx.settings.roles.find((r) => r.id === f.roleId)!.name, description: f.note || null, dueDate: null, sprintId: null, assigneeId: null,
        creatorId: ctx.userId!, kind: "task", assignmentId: null, assignmentSettings: null, teamName: null });
      await tx.execute(sql`UPDATE tasks SET item_type = 'event', stage = 'confirmed', status = ${statusForStage("event", "confirmed")}, on_board = false, type_fields = ${JSON.stringify(fields)}::jsonb WHERE id = ${tid}::uuid`);
      await tx.execute(sql`INSERT INTO community_events (task_id, workspace_id, place_limit) VALUES (${tid}::uuid, ${orgId}::uuid, ${places})`);
      first ||= tid;
    }
    return first;
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

type Ctx = NonNullable<Awaited<ReturnType<typeof org>>>;
type Placed = { state: "going" | "waitlisted" | "cant_go"; moved: Array<{ id: string }>; role: string; start: string };
/** One person's sign-up or Can't go on one shift, under the shift's lock (the RSVP slice: a full shift waitlists; Can't go moves the next up). */
async function place(ctx: Ctx, orgId: string, shiftId: string, who: { id: string; trained: string[] }, choice: "going" | "cant_go"): Promise<Placed | "closed" | "training"> {
  return db.transaction(async (tx) => {
    const [s] = Array.from(await tx.execute<{ fields: ShiftFields; stage: string; places: number }>(sql`
      SELECT t.type_fields AS fields, t.stage, e.place_limit AS places FROM tasks t JOIN community_events e ON e.task_id = t.id
      WHERE t.id = ${shiftId}::uuid AND t.workspace_id = ${orgId}::uuid AND t.item_type = 'event' AND t.type_fields->>'kind' = 'shift' AND t.deleted_at IS NULL FOR UPDATE OF e`));
    if (!s || s.stage === "cancelled" || Date.parse(s.fields.start) <= Date.now()) return "closed" as const;
    const role = ctx.settings.roles.find((r) => r.id === s.fields.roleId);
    if (choice === "going" && role?.training && !who.trained.includes(role.id)) return "training" as const;
    const [{ going, waiting } = { going: 0, waiting: 0 }] = Array.from(await tx.execute<{ going: number; waiting: number }>(sql`
      SELECT count(*) FILTER (WHERE state = 'going')::int AS going, count(*) FILTER (WHERE state = 'waitlisted')::int AS waiting FROM community_rsvps WHERE task_id = ${shiftId}::uuid AND user_id <> ${who.id}::uuid`));
    const [prev] = Array.from(await tx.execute<{ state: string }>(sql`SELECT state FROM community_rsvps WHERE task_id = ${shiftId}::uuid AND user_id = ${who.id}::uuid`));
    const state: Placed["state"] = choice === "cant_go" ? "cant_go" : prev?.state === "going" ? "going" : prev?.state === "waitlisted" ? "waitlisted" : waiting > 0 || going >= s.places ? "waitlisted" : "going";
    await tx.execute(sql`INSERT INTO community_rsvps (task_id, user_id, workspace_id, state) VALUES (${shiftId}::uuid, ${who.id}::uuid, ${orgId}::uuid, ${state})
      ON CONFLICT (task_id, user_id) DO UPDATE SET state = excluded.state, responded_at = CASE WHEN community_rsvps.state = excluded.state THEN community_rsvps.responded_at ELSE now() END,
        checked_in_at = CASE WHEN excluded.state = 'going' THEN community_rsvps.checked_in_at ELSE NULL END`);
    // A volunteer who can't go withdraws any swap they asked for on it.
    if (state === "cant_go") await tx.execute(sql`UPDATE volunteer_swaps SET state = 'withdrawn', answered_at = now() WHERE shift_id = ${shiftId}::uuid AND from_user = ${who.id}::uuid AND state = 'asked'`);
    return { state, moved: prev?.state === "going" && state === "cant_go" ? await promote(tx, shiftId) : [], role: role?.name ?? "a shift", start: s.fields.start };
  });
}
const tellMoved = async (ctx: Ctx, orgId: string, shiftId: string, out: Placed) => {
  for (const m of out.moved) await tell(orgId, ctx.slug, m.id, `A place opened: you’re on ${out.role} (${new Date(out.start).toUTCString().slice(0, 22)} UTC)`, `volunteer-moved-up:${shiftId}:${m.id}`);
};

/**
 * Sign up or Can't go (volunteers). Needs the current agreement and, for a role that needs it, the training sign-off.
 * A full shift puts you on the waitlist; Can't go frees your place and the waitlist moves up (told: Important).
 */
export async function shiftSignUpAction(orgId: string, shiftId: string, choice: "going" | "cant_go"): Promise<{ success: true; state: "going" | "waitlisted" | "cant_go" } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !ctx.settings.on || !isLooseUuid(shiftId) || (choice !== "going" && choice !== "cant_go")) return DENIED;
  if (choice === "going" && !agreedTo(ctx.settings, ctx.prefs)) return { success: false, error: "Agree to the volunteer agreement first." };
  const out = await place(ctx, orgId, shiftId, { id: ctx.userId!, trained: ctx.prefs.trained ?? [] }, choice);
  if (out === "closed") return { success: false, error: "This shift isn’t taking sign-ups." };
  if (out === "training") return { success: false, error: "This role needs a training sign-off first." };
  await tellMoved(ctx, orgId, shiftId, out);
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

// ── B8.1b (report 37.3 calls 3–6) ─────────────────────────────────────────────────────────────────────────────────────

/** Be a Regular (or stop): a place on every coming shift of a weekly series (waitlisted where full); stopping frees them. */
export async function setRegularAction(orgId: string, series: string, on: boolean): Promise<{ success: true; placed: number } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !ctx.settings.on || !isLooseUuid(series) || typeof on !== "boolean") return DENIED;
  if (on && !agreedTo(ctx.settings, ctx.prefs)) return { success: false, error: "Agree to the volunteer agreement first." };
  const coming = Array.from(await db.execute<{ id: string }>(sql`
    SELECT id FROM tasks WHERE workspace_id = ${orgId}::uuid AND item_type = 'event' AND type_fields->>'kind' = 'shift' AND type_fields->>'series' = ${series} AND deleted_at IS NULL
      AND stage <> 'cancelled' AND (type_fields->>'start')::timestamptz > now() ORDER BY type_fields->>'start' LIMIT 20`));
  if (!coming.length) return DENIED;
  let placed = 0;
  for (const c of coming) {
    const out = await place(ctx, orgId, c.id, { id: ctx.userId!, trained: ctx.prefs.trained ?? [] }, on ? "going" : "cant_go");
    if (out === "training") return { success: false, error: "This role needs a training sign-off first." };
    if (out === "closed") continue;
    placed++;
    await tellMoved(ctx, orgId, c.id, out);
  }
  await db.execute(sql`UPDATE workspace_members SET view_prefs = jsonb_set(coalesce(view_prefs, '{}'::jsonb), '{volunteer}', coalesce(view_prefs->'volunteer', '{}'::jsonb) || jsonb_build_object('regular',
    (SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements_text(coalesce(view_prefs->'volunteer'->'regular', '[]'::jsonb) ${on ? sql`|| to_jsonb(${series}::text)` : sql``}) x WHERE ${on} OR x <> ${series})))
    WHERE workspace_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid`);
  return { success: true, placed };
}

/** Ask a named volunteer to take my place on a shift (S4's swap); they must say yes. Viewers, the untrained and people already on it can't be asked. */
export async function askSwapAction(orgId: string, shiftId: string, to: string): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !isLooseUuid(shiftId) || !isLooseUuid(to) || to === ctx.userId) return DENIED;
  const [ok] = Array.from(await db.execute<{ role: string; start: string; prefs: Prefs | null; theirs: string | null }>(sql`
    SELECT t.type_fields->>'roleId' AS role, t.type_fields->>'start' AS start, m.view_prefs->'volunteer' AS prefs,
      (SELECT r2.state FROM community_rsvps r2 WHERE r2.task_id = t.id AND r2.user_id = ${to}::uuid) AS theirs
    FROM tasks t JOIN community_rsvps r ON r.task_id = t.id AND r.user_id = ${ctx.userId}::uuid AND r.state = 'going'
      JOIN workspace_members m ON m.workspace_id = t.workspace_id AND m.user_id = ${to}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL
    WHERE t.id = ${shiftId}::uuid AND t.workspace_id = ${orgId}::uuid AND t.type_fields->>'kind' = 'shift' AND t.stage <> 'cancelled' AND (t.type_fields->>'start')::timestamptz > now()`));
  if (!ok) return DENIED;
  const role = ctx.settings.roles.find((r) => r.id === ok.role);
  if (!agreedTo(ctx.settings, ok.prefs ?? {}) || (role?.training && !(ok.prefs?.trained ?? []).includes(role.id))) return { success: false, error: "They can’t take this shift yet (agreement or training)." };
  if (ok.theirs === "going" || ok.theirs === "waitlisted") return { success: false, error: "They’re already on this shift." };
  const made = Array.from(await db.execute(sql`INSERT INTO volunteer_swaps (org_id, shift_id, from_user, to_user) VALUES (${orgId}::uuid, ${shiftId}::uuid, ${ctx.userId}::uuid, ${to}::uuid)
    ON CONFLICT DO NOTHING RETURNING id`));
  if (!made.length) return { success: false, error: "You’ve already asked someone to swap this shift." };
  await tell(orgId, ctx.slug, to, `Can you take a ${role?.name ?? "volunteer"} shift on ${new Date(ok.start).toUTCString().slice(0, 22)} UTC?`, `volunteer-swap:${shiftId}:${to}`, "more");
  return { success: true };
}

const GONE = Symbol("gone");
const CANT = Symbol("cant");
/** Answer a swap (the volunteer asked): yes takes the place straight over; no leaves it with the asker. */
export async function answerSwapAction(orgId: string, swapId: string, accept: boolean): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !isLooseUuid(swapId) || typeof accept !== "boolean") return DENIED;
  const out = await db.transaction(async (tx) => {
    const [w] = Array.from(await tx.execute<{ shift_id: string; from_user: string }>(sql`
      UPDATE volunteer_swaps SET state = ${accept ? "accepted" : "declined"}, answered_at = now() WHERE id = ${swapId}::uuid AND org_id = ${orgId}::uuid AND to_user = ${ctx.userId}::uuid AND state = 'asked'
      RETURNING shift_id, from_user`));
    if (!w) return null;
    if (!accept) return w;
    // Security review: the person taking the place must still be able to (Volunteers on, the agreement, the role's training).
    const [sh] = Array.from(await tx.execute<{ role: string }>(sql`SELECT type_fields->>'roleId' AS role FROM tasks WHERE id = ${w.shift_id}::uuid`));
    const role = ctx.settings.roles.find((r) => r.id === sh?.role);
    if (!ctx.settings.on || !agreedTo(ctx.settings, ctx.prefs) || (role?.training && !(ctx.prefs.trained ?? []).includes(role.id))) throw CANT;
    await tx.execute(sql`SELECT 1 FROM community_events WHERE task_id = ${w.shift_id}::uuid FOR UPDATE`);
    const moved = Array.from(await tx.execute(sql`UPDATE community_rsvps SET state = 'cant_go', responded_at = now(), checked_in_at = NULL
      WHERE task_id = ${w.shift_id}::uuid AND user_id = ${w.from_user}::uuid AND state = 'going' AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = ${w.shift_id}::uuid AND t.stage <> 'cancelled' AND (t.type_fields->>'start')::timestamptz > now()) RETURNING user_id`));
    if (!moved.length) throw GONE; // rolls the swap back: the place left them meanwhile
    await tx.execute(sql`INSERT INTO community_rsvps (task_id, user_id, workspace_id, state) VALUES (${w.shift_id}::uuid, ${ctx.userId}::uuid, ${orgId}::uuid, 'going')
      ON CONFLICT (task_id, user_id) DO UPDATE SET state = 'going', responded_at = now()`);
    return w;
  }).catch((e: unknown) => { if (e === GONE) return "gone" as const; if (e === CANT) return "cant" as const; throw e; });
  if (out === "cant") return { success: false, error: "You can’t take this shift yet (agreement or training)." };
  if (out === "gone") return { success: false, error: "That place isn’t theirs to give any more." };
  if (!out) return DENIED;
  await tell(orgId, ctx.slug, out.from_user, accept ? "Your swap was accepted: someone took your shift" : "Your swap was declined: the shift is still yours", `volunteer-swap-answer:${swapId}`, "more");
  return { success: true };
}

/** Add hours by hand (volunteers): they count once a coordinator confirms them. */
export async function addHoursAction(orgId: string, input: { day: string; hours: number; roleId: string | null; note: string }): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !ctx.settings.on) return DENIED;
  const day = typeof input?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : null;
  const hours = Number(input?.hours);
  if (!day || Date.parse(`${day}T00:00:00Z`) > Date.now() || !(hours > 0 && hours <= 24) || (input.roleId && !ctx.settings.roles.some((r) => r.id === input.roleId))) return { success: false, error: "Pick a day that has passed and up to 24 hours." };
  await db.execute(sql`INSERT INTO volunteer_hours (org_id, user_id, day, hours, role_id, note) VALUES (${orgId}::uuid, ${ctx.userId}::uuid, ${day}::date, ${Math.round(hours * 4) / 4}, ${input.roleId || null}, ${String(input.note ?? "").slice(0, 500)})`);
  const coordinators = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role IN ('owner', 'admin') AND completed_at IS NULL LIMIT 20`));
  for (const c of coordinators) if (c.id !== ctx.userId) await tell(orgId, ctx.slug, c.id, "Volunteer hours are waiting for confirmation", `volunteer-hours-waiting:${orgId}:${c.id}:${new Date().toISOString().slice(0, 10)}`, "more");
  return { success: true };
}

/** Confirm (or decline) hours added by hand (coordinators). */
export async function confirmHoursAction(orgId: string, id: string, confirm: boolean): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.coordinator || !isLooseUuid(id) || typeof confirm !== "boolean") return DENIED;
  const done = Array.from(await db.execute(sql`UPDATE volunteer_hours SET state = ${confirm ? "confirmed" : "declined"}, confirmed_by = ${ctx.userId}::uuid, confirmed_at = now()
    WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid AND state = 'waiting' RETURNING id`));
  return done.length ? { success: true } : DENIED;
}

/** My availability (volunteers): typed weekly times, for coordinators' suggestions. */
export async function saveAvailabilityAction(orgId: string, text: string): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || typeof text !== "string") return DENIED;
  await db.execute(sql`UPDATE workspace_members SET view_prefs = jsonb_set(coalesce(view_prefs, '{}'::jsonb), '{volunteer}', coalesce(view_prefs->'volunteer', '{}'::jsonb) || jsonb_build_object('availability', ${text.trim().slice(0, 200)}::text))
    WHERE workspace_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid`);
  return { success: true };
}

/** Ask suitable volunteers to fill a short shift (coordinators): agreed, trained for the role, not on it; one message each. */
export async function askForShiftAction(orgId: string, shiftId: string): Promise<{ success: true; asked: number } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.coordinator || !isLooseUuid(shiftId)) return DENIED;
  const [s] = Array.from(await db.execute<{ fields: ShiftFields }>(sql`SELECT type_fields AS fields FROM tasks WHERE id = ${shiftId}::uuid AND workspace_id = ${orgId}::uuid AND type_fields->>'kind' = 'shift' AND stage <> 'cancelled' AND deleted_at IS NULL`));
  if (!s || Date.parse(s.fields.start) <= Date.now()) return DENIED;
  const role = ctx.settings.roles.find((r) => r.id === s.fields.roleId);
  const people = Array.from(await db.execute<{ id: string }>(sql`
    SELECT m.user_id AS id FROM workspace_members m WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL
      AND (${!ctx.settings.agreement.text} OR coalesce((m.view_prefs->'volunteer'->>'agreed')::int, -1) >= ${ctx.settings.agreement.version})
      ${role?.training ? sql`AND coalesce(m.view_prefs->'volunteer'->'trained', '[]'::jsonb) ? ${role.id}` : sql``}
      AND NOT EXISTS (SELECT 1 FROM community_rsvps r WHERE r.task_id = ${shiftId}::uuid AND r.user_id = m.user_id AND r.state IN ('going', 'waitlisted')) LIMIT 50`));
  for (const p of people) await tell(orgId, ctx.slug, p.id, `Can you help? ${role?.name ?? "A shift"} on ${new Date(s.fields.start).toUTCString().slice(0, 22)} UTC is short`, `volunteer-ask:${shiftId}:${p.id}`, "more");
  return { success: true, asked: people.length };
}

/** Add to my profile (volunteers, with their yes): "42 hours volunteering with Food bank, 2026", from confirmed hours. */
export async function addHoursToProfileAction(orgId: string): Promise<{ success: true; hours: number } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !ctx.settings.on) return DENIED;
  const year = new Date().getUTCFullYear();
  const total = await hoursFor(orgId, ctx.userId!, year);
  if (!(total.confirmed > 0)) return { success: false, error: "There are no confirmed hours this year yet." };
  const title = `${total.confirmed} hours volunteering with ${ctx.w.title}, ${year}`.slice(0, 300);
  await db.execute(sql`INSERT INTO profile_contributions (profile_id, external_key, project_title, project_url, source, role_kind, role_title, summary, visibility)
    VALUES (${ctx.userId}::uuid, ${`volunteer-hours:${orgId}:${year}`}, ${title}, ${null}, 'manual', 'contributor', 'Volunteer', ${`Confirmed by ${ctx.w.title}`}, 'public')
    ON CONFLICT (profile_id, external_key) WHERE deleted_at IS NULL AND workspace_id IS NULL DO UPDATE SET project_title = excluded.project_title, updated_at = now()`);
  const { markProfileCollaborationSummaryStale } = await import("@/lib/profile/collaboration");
  await markProfileCollaborationSummaryStale([ctx.userId!]).catch(() => undefined);
  return { success: true, hours: total.confirmed };
}

/** Hours (call 5): checked-in shift time plus additions a coordinator confirmed; additions waiting are shown apart. */
async function hoursFor(orgId: string, userId: string, year: number) {
  const done = await shifts(orgId, userId, sql`EXISTS (SELECT 1 FROM community_rsvps r WHERE r.task_id = t.id AND r.user_id = ${userId}::uuid AND r.checked_in_at IS NOT NULL)
    AND (t.type_fields->>'start')::timestamptz >= ${`${year}-01-01`}::timestamptz AND (t.type_fields->>'start')::timestamptz < ${`${year + 1}-01-01`}::timestamptz`);
  const [h] = Array.from(await db.execute<{ confirmed: string | null; waiting: string | null }>(sql`
    SELECT sum(hours) FILTER (WHERE state = 'confirmed')::text AS confirmed, sum(hours) FILTER (WHERE state = 'waiting')::text AS waiting FROM volunteer_hours
    WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND day >= ${`${year}-01-01`}::date AND day < ${`${year + 1}-01-01`}::date`));
  const fromShifts = shiftHours(done.map((d) => d.fields));
  return { shifts: done.length, fromShifts, confirmed: Math.round((fromShifts + Number(h?.confirmed ?? 0)) * 10) / 10, waiting: Number(h?.waiting ?? 0) };
}
