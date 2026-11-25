"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { eventFieldsSchema, forMe, occurrences, type EventFields } from "@/lib/organizations/school-events";
import { readSchoolYear } from "@/lib/organizations/school-year";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 32.2 S1 (plan B3.1b): school and class events. A school's admins add school events; a class's staff add its
 * own. A class sees the school's events too (Set by the school) and everyone can filter For me. Public events show on
 * the school's About. Events never go on the board (an `event` item with no board stage).
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function viewer() {
  const auth: { user: { id: string } | null; tokenKind?: string | null } = await requireAuthenticatedUser().catch(() => ({ user: null }));
  return { userId: auth.user?.id ?? null, token: auth.tokenKind != null };
}
async function org(orgId: string) {
  const [w] = Array.from(await db.execute<{ id: string; title: string; level: string | null; institution_id: string | null; settings: unknown; kind: string }>(sql`
    SELECT id, title, org_level AS level, institution_id, org_settings AS settings, kind FROM workspaces WHERE id = ${orgId}::uuid AND deleted_at IS NULL`));
  return w?.kind === "organization" ? w : null;
}

type EventRow = { id: string; title: string; stage: string; fields: EventFields; owner: string | null; workspace_id: string };
async function eventsOf(orgIds: string[]) {
  if (!orgIds.length) return [] as EventRow[];
  const rows = Array.from(await db.execute<{ id: string; title: string; stage: string | null; fields: unknown; owner: string | null; workspace_id: string }>(sql`
    SELECT t.id, t.title, t.stage, t.type_fields AS fields, coalesce(p.full_name, p.username) AS owner, t.workspace_id FROM tasks t LEFT JOIN profiles p ON p.id = t.assignee_id
    WHERE t.workspace_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(orgIds)}::jsonb)::uuid) AND t.item_type = 'event' AND t.deleted_at IS NULL`));
  return rows.flatMap((r) => { const f = eventFieldsSchema.safeParse(r.fields); return f.success ? [{ ...r, stage: r.stage ?? "planned", fields: f.data }] : []; });
}

/** Events between two days: this organization's, and for a class its school's (marked as the school's). */
export async function readEventsAction(orgId: string, from: string, to: string) {
  try {
    const { userId } = await viewer();
    if (!userId || !isLooseUuid(orgId) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from
      || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > 400) return DENIED;
    const a = await getWorkspaceAccessById(orgId, userId);
    const o = await org(orgId);
    if (!o || !a.canRead || !(a.isOwner || a.isMember)) return DENIED;
    const schoolId = o.level === "institution" ? o.id : o.institution_id;
    const school = schoolId && schoolId !== o.id ? await org(schoolId) : o.level === "institution" ? o : null;
    const year = readSchoolYear(school?.settings ?? o.settings);
    // For me: the classes of the school I'm in, and my role in the school.
    const myClasses = schoolId ? Array.from(await db.execute<{ id: string }>(sql`
      SELECT w.id FROM workspaces w WHERE w.institution_id = ${schoolId}::uuid AND w.deleted_at IS NULL
        AND (w.owner_id = ${userId}::uuid OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId}::uuid))`)).map((r) => r.id) : [];
    const schoolAccess = schoolId ? await getWorkspaceAccessById(schoolId, userId) : null;
    const role = schoolAccess?.isOwner ? "owner" as const : (schoolAccess?.memberRole as "admin" | "member" | "viewer" | null) ?? null;
    const rows = await eventsOf([...new Set([o.id, ...(schoolId ? [schoolId] : [])])]);
    // Review: a school event shows to the people in its audience and to the school's admins; a class's own to its members.
    const runsSchool = role === "owner" || role === "admin";
    const visible = rows.filter((e) => e.workspace_id === o.id && o.level !== "institution" ? true : runsSchool || forMe(e.fields.audience, { classIds: myClasses, role }));
    const items = visible.flatMap((e) => occurrences(e.fields, from, to, year).map((day) => ({ id: e.id, day, title: e.title, stage: e.stage, type: e.fields.type, time: e.fields.time, place: e.fields.place,
      owner: e.owner, public: e.fields.public, fromSchool: e.workspace_id !== o.id, forMe: forMe(e.fields.audience, { classIds: myClasses, role }), repeats: Boolean(e.fields.repeat) })))
      .sort((x, y) => `${x.day}${x.time ?? ""}`.localeCompare(`${y.day}${y.time ?? ""}`));
    const canAdd = a.canWrite && (a.isOwner || a.memberRole === "admin");
    return { success: true as const, items, canAdd, schoolTitle: school && school.id !== o.id ? school.title : null };
  } catch (error) {
    logger.warn("school_events.read_failed", { orgId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t load the events." };
  }
}

/** + Event: a school's admins at the school; a class's staff in the class. Never a token. */
export async function createEventAction(orgId: string, title: string, fields: unknown): Promise<{ success: true; id: string } | Failure> {
  const { userId, token } = await viewer();
  if (!userId || token || !isLooseUuid(orgId)) return DENIED;
  const a = await getWorkspaceAccessById(orgId, userId);
  if (!(await org(orgId)) || !a.canWrite || !(a.isOwner || a.memberRole === "admin")) return DENIED;
  const name = String(title ?? "").trim().slice(0, 200);
  if (!name) return { success: false, error: "Name the event." };
  const parsed = eventFieldsSchema.safeParse(fields);
  if (!parsed.success) return { success: false, error: "Check the event’s date, time and audience." };
  if (parsed.data.repeat && parsed.data.repeat.until < parsed.data.date) return { success: false, error: "A repeat ends after the first day." };
  const { createTaskAction } = await import("@/lib/workspaces/server/tasks");
  const r = await createTaskAction({ projectId: orgId, title: name, status: "todo", priority: "medium", itemType: "event", stage: "planned", typeFields: parsed.data } as Parameters<typeof createTaskAction>[0]);
  if (!r.success || !("task" in r) || !r.task) return { success: false, error: (r.success ? null : r.error) ?? "Couldn’t add the event." };
  return { success: true, id: r.task.id };
}

/** Change an event's status (Planned, Confirmed, Done, Cancelled) — the same people who add events. */
export async function setEventStatusAction(orgId: string, eventId: string, stage: "planned" | "confirmed" | "done" | "cancelled"): Promise<{ success: true } | Failure> {
  const { userId, token } = await viewer();
  if (!userId || token || !isLooseUuid(orgId) || !isLooseUuid(eventId) || !["planned", "confirmed", "done", "cancelled"].includes(stage)) return DENIED;
  const a = await getWorkspaceAccessById(orgId, userId);
  if (!a.canWrite || !(a.isOwner || a.memberRole === "admin")) return DENIED;
  const done = Array.from(await db.execute<{ id: string }>(sql`
    UPDATE tasks SET stage = ${stage}, status = ${stage === "done" || stage === "cancelled" ? "done" : "todo"}, updated_at = now()
    WHERE id = ${eventId}::uuid AND workspace_id = ${orgId}::uuid AND item_type = 'event' AND deleted_at IS NULL RETURNING id`));
  return done.length ? { success: true } : DENIED;
}

/** The school's About: public events only, with nothing about who's in them (call 8). */
export async function readPublicEventsAction(schoolId: string) {
  if (!isLooseUuid(schoolId)) return DENIED;
  const { userId } = await viewer();
  const a = await getWorkspaceAccessById(schoolId, userId);
  const o = await org(schoolId);
  if (!o || o.level !== "institution" || !a.canRead) return DENIED;
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
  const year = readSchoolYear(o.settings);
  const items = (await eventsOf([schoolId])).filter((e) => e.fields.public && e.stage !== "cancelled")
    .flatMap((e) => occurrences(e.fields, today, until, year).map((day) => ({ day, title: e.title, time: e.fields.time, place: e.fields.place, type: e.fields.type })))
    .sort((x, y) => x.day.localeCompare(y.day)).slice(0, 30);
  return { success: true as const, items, holidays: (year?.days ?? []).filter((d) => d.kind === "holiday" && d.end >= today).map((d) => ({ name: d.name, start: d.start, end: d.end })) };
}
