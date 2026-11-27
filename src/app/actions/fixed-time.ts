"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { addDays, bookingSchema, countdown, debriefSchema, defaultEnd, fixedTimeSchema, offsetWords, readFixedTime, STARTERS, workstreamsSchema, type Booking } from "@/lib/organizations/fixed-time";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 37.4 (plan B8.2a, X3 calls 1–4): an organization's key date and end date, the countdown line, a plan starter
 * laid out backwards from the key date, and moving the key date: a preview of what moves, then the move. A task moves
 * only while its date is the one the plan worked out (a date changed by hand stays); a key date that has passed needs a
 * reason, kept for the debrief. The team is told (Important). Organisers are the owner and admins.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
type Plan = { offset: number; phase: string; set: string };

async function org(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ settings: unknown; slug: string | null; title: string; status: string }>(sql`
    SELECT org_settings AS settings, slug, title, status FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (!w || !a.canRead || !(a.isOwner || a.isMember)) return null;
  return { userId, w, fixed: readFixedTime(w.settings), organiser: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, owner: a.isOwner && !a.writeBlocked,
    member: !a.writeBlocked && (a.isOwner || a.memberRole !== "viewer") };
}
const today = () => new Date().toISOString().slice(0, 10);
const noon = (date: string) => new Date(`${date}T12:00:00Z`);

/** Dates (members): the key and end dates, the countdown line, and this week's plan tasks worked back from the key date. */
export async function readFixedTimeAction(orgId: string) {
  const ctx = await org(orgId);
  if (!ctx) return DENIED;
  const f = ctx.fixed;
  if (!f) return { success: true as const, fixed: null, organiser: ctx.organiser, starters: Object.entries(STARTERS).map(([id, s]) => ({ id, name: s.name, tasks: s.tasks.length })) };
  const week = Array.from(await db.execute<{ id: string; title: string; due: string; plan: Plan; hand: boolean }>(sql`
    SELECT id, title, (due_date AT TIME ZONE 'UTC')::date::text AS due, type_fields->'plan' AS plan, (due_date AT TIME ZONE 'UTC')::date::text <> type_fields->'plan'->>'set' AS hand
    FROM tasks WHERE workspace_id = ${orgId}::uuid AND deleted_at IS NULL AND status <> 'done' AND type_fields ? 'plan'
      AND due_date < ${noon(addDays(today(), 7)).toISOString()}::timestamptz ORDER BY due_date LIMIT 30`));
  // B8.2b: bookings (with supplier and reference), and on the day the issues raised today.
  const bookings = Array.from(await db.execute<{ id: string; title: string; booking: Booking; due: string | null; owner: string | null }>(sql`
    SELECT t.id, t.title, t.type_fields->'booking' AS booking, (t.due_date AT TIME ZONE 'UTC')::date::text AS due, coalesce(p.full_name, p.username) AS owner
    FROM tasks t LEFT JOIN profiles p ON p.id = coalesce(t.assignee_id, t.creator_id) WHERE t.workspace_id = ${orgId}::uuid AND t.deleted_at IS NULL AND t.type_fields ? 'booking' ORDER BY t.created_at LIMIT 100`));
  const state = countdown(f, today()).state;
  const issues = state === "today" ? Array.from(await db.execute<{ id: string; title: string; done: boolean; by: string | null }>(sql`
    SELECT t.id, t.title, t.status = 'done' AS done, coalesce(p.full_name, p.username) AS by FROM tasks t LEFT JOIN profiles p ON p.id = t.creator_id
    WHERE t.workspace_id = ${orgId}::uuid AND t.deleted_at IS NULL AND (t.type_fields->>'issue')::boolean IS TRUE AND t.created_at >= ${noon(today()).toISOString()}::timestamptz - interval '12 hours' ORDER BY t.created_at LIMIT 100`)) : [];
  const owners = (f.workstreams ?? []).some((x) => x.owner) ? Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT id, coalesce(full_name, username, 'Member') AS name FROM profiles WHERE id = ANY(${`{${(f.workstreams ?? []).flatMap((x) => (x.owner ? [x.owner] : [])).join(",")}}`}::uuid[])`)) : [];
  const people = ctx.organiser ? Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 300`)) : [];
  return { success: true as const, organiser: ctx.organiser, member: ctx.member, starters: Object.entries(STARTERS).map(([id, s]) => ({ id, name: s.name, tasks: s.tasks.length })), people,
    fixed: { keyDate: f.keyDate, endDate: f.endDate, starter: f.starter ?? null, ...countdown(f, today()), moves: f.moves ?? [], closed: ctx.w.status === "archived",
      wrap: { thank: Boolean(f.wrap?.thank), photos: Boolean(f.wrap?.photos), debrief: Boolean(f.debrief), report: Boolean(f.wrap?.report) }, debrief: f.debrief ?? null, pinned: f.pinned ?? null },
    owner: ctx.owner, title: ctx.w.title,
    workstreams: (f.workstreams ?? []).map((x) => ({ ...x, ownerName: owners.find((o) => o.id === x.owner)?.name ?? null })),
    bookings: bookings.map((b) => ({ id: b.id, title: b.title, ...b.booking, due: b.due, owner: b.owner })), issues,
    week: week.map((t) => ({ id: t.id, title: t.title, due: t.due, phase: t.plan.phase, offset: offsetWords(t.plan.offset), handSet: t.hand, overdue: t.due < today() })) };
}

/** Set the key date and end date the first time (organisers); later changes go through Move the key date. */
export async function setFixedTimeAction(orgId: string, input: { keyDate: string; endDate?: string | null }): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.organiser) return DENIED;
  const parsed = fixedTimeSchema.safeParse({ keyDate: input?.keyDate, endDate: input?.endDate || (typeof input?.keyDate === "string" ? defaultEnd(input.keyDate) : "") });
  if (!parsed.success) return { success: false, error: "Pick the key date, and an end date on or after it." };
  if (ctx.fixed && ctx.fixed.keyDate !== parsed.data.keyDate) return { success: false, error: "Move the key date with Move, so the plan moves with it." };
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{fixedTime}', coalesce(org_settings->'fixedTime', '{}'::jsonb) || ${JSON.stringify(parsed.data)}::jsonb)
    WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** Pick a plan starter (organisers, once): its tasks land with dates worked out backwards from the key date. */
export async function applyStarterAction(orgId: string, starter: string): Promise<{ success: true; tasks: number } | Failure> {
  const ctx = await org(orgId);
  const s = STARTERS[starter];
  if (!ctx?.organiser || !s) return DENIED;
  if (!ctx.fixed) return { success: false, error: "Set the key date first." };
  if (ctx.fixed.starter) return { success: false, error: "This team already has a plan." };
  const { insertTask } = await import("@/lib/organizations/assignments");
  const key = ctx.fixed.keyDate;
  const PLANNED = Symbol("planned");
  const out = await db.transaction(async (tx) => {
    const [locked] = Array.from(await tx.execute<{ starter: string | null }>(sql`SELECT org_settings->'fixedTime'->>'starter' AS starter FROM workspaces WHERE id = ${orgId}::uuid FOR UPDATE`));
    if (locked?.starter) throw PLANNED; // someone picked a plan meanwhile
    for (const t of s.tasks) {
      const set = addDays(key, t.offset);
      const id = await insertTask(tx as never, { projectId: orgId, title: t.title, description: null, dueDate: noon(set), sprintId: null, assigneeId: null, creatorId: ctx.userId,
        kind: "task", assignmentId: null, assignmentSettings: null, teamName: null });
      await tx.execute(sql`UPDATE tasks SET type_fields = coalesce(type_fields, '{}'::jsonb) || jsonb_build_object('plan', ${JSON.stringify({ offset: t.offset, phase: t.phase, set } satisfies Plan)}::jsonb) WHERE id = ${id}::uuid`);
    }
    await tx.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{fixedTime,starter}', to_jsonb(${starter}::text)) WHERE id = ${orgId}::uuid`);
    return "ok" as const;
  }).catch((e: unknown) => { if (e === PLANNED) return "planned" as const; throw e; });
  if (out === "planned") return { success: false, error: "This team already has a plan." };
  return { success: true, tasks: s.tasks.length };
}

async function planned(orgId: string) {
  return Array.from(await db.execute<{ id: string; title: string; due: string | null; plan: Plan }>(sql`
    SELECT id, title, (due_date AT TIME ZONE 'UTC')::date::text AS due, type_fields->'plan' AS plan FROM tasks
    WHERE workspace_id = ${orgId}::uuid AND deleted_at IS NULL AND type_fields ? 'plan' ORDER BY due_date NULLS LAST LIMIT 500`));
}

/** Preview moving the key date (organisers): every date that moves, and the ones set by hand that stay. */
export async function previewMoveAction(orgId: string, keyDate: string) {
  const ctx = await org(orgId);
  if (!ctx?.organiser || !ctx.fixed || !/^\d{4}-\d{2}-\d{2}$/.test(String(keyDate))) return DENIED;
  const rows = await planned(orgId);
  return { success: true as const, passed: ctx.fixed.keyDate < today(),
    moves: rows.filter((r) => r.due === r.plan.set).map((r) => ({ id: r.id, title: r.title, from: r.due, to: addDays(keyDate, r.plan.offset) })),
    stays: rows.filter((r) => r.due !== r.plan.set).map((r) => ({ id: r.id, title: r.title, due: r.due })) };
}

/** Move the key date (organisers): plan dates move with it, hand-set ones stay; the end date keeps its distance. */
export async function moveKeyDateAction(orgId: string, keyDate: string, reason?: string | null): Promise<{ success: true; moved: number } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.organiser || !ctx.fixed || !/^\d{4}-\d{2}-\d{2}$/.test(String(keyDate)) || keyDate === ctx.fixed.keyDate) return DENIED;
  const passed = ctx.fixed.keyDate < today();
  const why = typeof reason === "string" ? reason.trim().slice(0, 300) : "";
  if (passed && !why) return { success: false, error: "The key date has passed: say why it’s moving (it’s kept for the debrief)." };
  const delta = Math.round((Date.parse(`${keyDate}T00:00:00Z`) - Date.parse(`${ctx.fixed.keyDate}T00:00:00Z`)) / 86_400_000);
  const moved = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM workspaces WHERE id = ${orgId}::uuid FOR UPDATE`);
    const rows = Array.from(await tx.execute<{ id: string; offset: number }>(sql`
      SELECT id, (type_fields->'plan'->>'offset')::int AS offset FROM tasks WHERE workspace_id = ${orgId}::uuid AND deleted_at IS NULL AND type_fields ? 'plan'
        AND (due_date AT TIME ZONE 'UTC')::date::text = type_fields->'plan'->>'set' FOR UPDATE`));
    for (const r of rows) {
      const set = addDays(keyDate, r.offset);
      await tx.execute(sql`UPDATE tasks SET due_date = ${noon(set).toISOString()}::timestamptz, type_fields = jsonb_set(type_fields, '{plan,set}', to_jsonb(${set}::text)), updated_at = now() WHERE id = ${r.id}::uuid`);
    }
    const move = { from: ctx.fixed!.keyDate, to: keyDate, reason: why || null, at: new Date().toISOString() };
    await tx.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{fixedTime}', org_settings->'fixedTime' || ${JSON.stringify({ keyDate, endDate: addDays(ctx.fixed!.endDate, delta), moves: [...(ctx.fixed!.moves ?? []), move] })}::jsonb)
      WHERE id = ${orgId}::uuid`);
    return rows.length;
  });
  const team = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND completed_at IS NULL AND role <> 'viewer' LIMIT 2000`));
  const slug = ctx.w.slug ?? orgId;
  for (const m of team) if (m.id !== ctx.userId) await createNotification({ recipientUserId: m.id, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "important",
    title: `${ctx.w.title}: the key date moved to ${new Date(`${keyDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`,
    href: `/org/${encodeURIComponent(slug)}`, entityRefs: { projectId: orgId, projectSlug: slug }, dedupeKey: `fixed-time-move:${orgId}:${keyDate}:${m.id}` }).catch(() => undefined);
  return { success: true, moved };
}

/** Workstreams (organisers): up to 12, each with an owner who sees its bookings. */
export async function saveWorkstreamsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.organiser || !ctx.fixed) return DENIED;
  const parsed = workstreamsSchema.safeParse(input);
  if (!parsed.success || new Set(parsed.data.map((x) => x.id)).size !== parsed.data.length) return { success: false, error: "Each workstream needs a name; up to 12." };
  const owners = parsed.data.flatMap((x) => (x.owner ? [x.owner] : []));
  if (owners.length) {
    const ok = Array.from(await db.execute(sql`SELECT user_id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role <> 'viewer' AND completed_at IS NULL AND user_id = ANY(${`{${owners.join(",")}}`}::uuid[])`));
    if (ok.length !== new Set(owners).size) return { success: false, error: "Owners are people on the team." };
  }
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{fixedTime,workstreams}', ${JSON.stringify(parsed.data)}::jsonb) WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** Add a booking (organisers and workstream owners): what, supplier, and the date it's needed by (14 days before the key date by default). */
export async function addBookingAction(orgId: string, input: { title: string; supplier: string; workstream: string | null; neededBy?: string | null }): Promise<{ success: true; id: string } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !ctx.fixed) return DENIED;
  const ws = input?.workstream ? (ctx.fixed.workstreams ?? []).find((x) => x.id === input.workstream) : null;
  if (!(ctx.organiser || (ws && ws.owner === ctx.userId))) return DENIED;
  const title = typeof input?.title === "string" ? input.title.trim().slice(0, 120) : "";
  if (!title) return { success: false, error: "Say what’s being booked." };
  const neededBy = typeof input?.neededBy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.neededBy) ? input.neededBy : addDays(ctx.fixed.keyDate, -14);
  const booking: Booking = { supplier: String(input?.supplier ?? "").trim().slice(0, 120), ref: "", state: "to_book", workstream: ws?.id ?? null };
  const { insertTask } = await import("@/lib/organizations/assignments");
  const id = await db.transaction(async (tx) => {
    const tid = await insertTask(tx as never, { projectId: orgId, title, description: null, dueDate: noon(neededBy), sprintId: null, assigneeId: ws?.owner ?? ctx.userId, creatorId: ctx.userId,
      kind: "task", assignmentId: null, assignmentSettings: null, teamName: null });
    await tx.execute(sql`UPDATE tasks SET type_fields = coalesce(type_fields, '{}'::jsonb) || jsonb_build_object('booking', ${JSON.stringify(booking)}::jsonb) WHERE id = ${tid}::uuid`);
    return tid;
  });
  return { success: true, id };
}

/** Update a booking (organisers, its workstream's owner, or whoever it's assigned to): state, supplier, typed reference. */
export async function updateBookingAction(orgId: string, taskId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !ctx.fixed || !isLooseUuid(taskId)) return DENIED;
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "A confirmed booking has its reference." };
  const [t] = Array.from(await db.execute<{ booking: Booking; assignee: string | null }>(sql`SELECT type_fields->'booking' AS booking, assignee_id AS assignee FROM tasks
    WHERE id = ${taskId}::uuid AND workspace_id = ${orgId}::uuid AND deleted_at IS NULL AND type_fields ? 'booking'`));
  if (!t) return DENIED;
  const owner = (ctx.fixed.workstreams ?? []).find((x) => x.id === t.booking.workstream)?.owner;
  if (!(ctx.organiser || owner === ctx.userId || t.assignee === ctx.userId)) return DENIED;
  const status = parsed.data.state === "confirmed" || parsed.data.state === "cancelled" ? "done" : "todo";
  await db.execute(sql`UPDATE tasks SET type_fields = jsonb_set(type_fields, '{booking}', ${JSON.stringify({ ...parsed.data, workstream: t.booking.workstream })}::jsonb), status = ${status}, updated_at = now() WHERE id = ${taskId}::uuid`);
  return { success: true };
}

/** Raise an issue on the day (any team member, one line): a task marked Issue, shown in Issues today. */
export async function raiseIssueAction(orgId: string, title: string): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !ctx.fixed || typeof title !== "string" || !title.trim()) return DENIED;
  if (countdown(ctx.fixed, today()).state !== "today") return { success: false, error: "Issues today are for the day itself." };
  const { insertTask } = await import("@/lib/organizations/assignments");
  await db.transaction(async (tx) => {
    const tid = await insertTask(tx as never, { projectId: orgId, title: title.trim().slice(0, 200), description: null, dueDate: noon(today()), sprintId: null, assigneeId: null, creatorId: ctx.userId,
      kind: "task", assignmentId: null, assignmentSettings: null, teamName: null });
    await tx.execute(sql`UPDATE tasks SET type_fields = coalesce(type_fields, '{}'::jsonb) || '{"issue": true}'::jsonb WHERE id = ${tid}::uuid`);
  });
  return { success: true };
}

/** Mark an issue solved (or open again) on the day (any team member). */
export async function solveIssueAction(orgId: string, taskId: string, done: boolean): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member || !isLooseUuid(taskId) || typeof done !== "boolean") return DENIED;
  const ok = Array.from(await db.execute(sql`UPDATE tasks SET status = ${done ? "done" : "todo"}, updated_at = now() WHERE id = ${taskId}::uuid AND workspace_id = ${orgId}::uuid AND (type_fields->>'issue')::boolean IS TRUE RETURNING id`));
  return ok.length ? { success: true } : DENIED;
}

// ── B8.2c (report 37.4 calls 5–7): wrap-up, debrief, Run it again, the profile entry ───────────────────────────────────

/** Tick the wrap-up checklist (organisers): thank volunteers, collect photos and files, an optional report. */
export async function saveWrapAction(orgId: string, item: "thank" | "photos" | "report", on: boolean): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.organiser || !ctx.fixed || !["thank", "photos", "report"].includes(item) || typeof on !== "boolean") return DENIED;
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{fixedTime,wrap}', coalesce(org_settings->'fixedTime'->'wrap', '{}'::jsonb) || jsonb_build_object(${item}::text, ${on})) WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** The debrief (organisers; 11.6's Retrospective with the post-mortem's headings): Summary · What went well · What went wrong · Next time. */
export async function saveFixedDebriefAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.organiser || !ctx.fixed) return DENIED;
  const parsed = debriefSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Write at least the summary." };
  const moves = (ctx.fixed.moves ?? []).filter((m) => m.reason);
  // A key date moved after it passed keeps its reason in the debrief (edge 1).
  const wrong = moves.length && !parsed.data.wrong.includes("Key date moved") ? `${parsed.data.wrong}${parsed.data.wrong ? "\n" : ""}${moves.map((m) => `Key date moved from ${m.from} to ${m.to}: ${m.reason}`).join("\n")}` : parsed.data.wrong;
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{fixedTime,debrief}', ${JSON.stringify({ ...parsed.data, wrong })}::jsonb) WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/**
 * Run it again (the owner): the built duplicate with About and documents, dates moved to the new key date, no members,
 * messages or work; the copy pins this run's debrief and its Next time lines become tasks (lifecycle.ts duplicateOrg).
 */
export async function runItAgainAction(orgId: string, input: { title: string; handle: string; keyDate: string }): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.owner || !ctx.fixed || !/^\d{4}-\d{2}-\d{2}$/.test(String(input?.keyDate)) || input.keyDate <= ctx.fixed.keyDate) return { success: false, error: "Pick a new key date after this one." };
  const { duplicateOrgAction } = await import("@/app/actions/org-lifecycle");
  return duplicateOrgAction(orgId, { title: String(input.title ?? ""), handle: String(input.handle ?? ""), termStart: input.keyDate,
    copy: { about: true, docs: true, files: false, sprints: false, assignments: false, channels: false, admins: false } });
}

/** Add "Organising team, Book Fest 2027" to my profile (members, after the key date, with their yes). */
export async function addTeamToProfileAction(orgId: string): Promise<{ success: true } | Failure> {
  const ctx = await org(orgId);
  if (!ctx?.member) return DENIED;
  if (!ctx.fixed || ctx.fixed.keyDate > today()) return { success: false, error: "This can go on your profile once the day has happened." };
  const year = ctx.fixed.keyDate.slice(0, 4);
  const title = `Organising team, ${ctx.w.title}`.slice(0, 300);
  const made = Array.from(await db.execute(sql`INSERT INTO profile_contributions (profile_id, external_key, project_title, project_url, source, role_kind, role_title, summary, visibility)
    VALUES (${ctx.userId}::uuid, ${`fixed-team:${orgId}`}, ${title}, ${null}, 'manual', 'contributor', ${ctx.organiser ? "Organiser" : "Team member"}, ${`${year} · confirmed by ${ctx.w.title}`}, 'public')
    ON CONFLICT (profile_id, external_key) WHERE deleted_at IS NULL AND workspace_id IS NULL DO NOTHING RETURNING id`));
  if (!made.length) return { success: false, error: "It’s already on your profile." };
  const { markProfileCollaborationSummaryStale } = await import("@/lib/profile/collaboration");
  await markProfileCollaborationSummaryStale([ctx.userId]).catch(() => undefined);
  return { success: true };
}

