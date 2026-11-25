"use server";

import { sql } from "drizzle-orm";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { eventFieldsSchema, occurrences } from "@/lib/organizations/school-events";
import { eventsFor, eventsOf, notifyEventCancelled, schoolOrg } from "@/lib/organizations/school-events-server";
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
/** Events between two days: this organization's, and for a class its school's (marked as the school's). */
export async function readEventsAction(orgId: string, from: string, to: string) {
  try {
    const { userId } = await viewer();
    if (!userId || !isLooseUuid(orgId) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from
      || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > 400) return DENIED;
    const r = await eventsFor(orgId, userId, from, to);
    if (!r) return DENIED;
    const o = await schoolOrg(orgId);
    return { success: true as const, items: r.items, canAdd: r.canAdd, schoolTitle: r.schoolTitle, isSchool: o?.level === "institution", schoolId: o?.level === "institution" ? o.id : o?.institution_id ?? null };
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
  if (!(await schoolOrg(orgId)) || !a.canWrite || !(a.isOwner || a.memberRole === "admin")) return DENIED;
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
  if (!done.length) return DENIED;
  // Layer 15: cancelled within 48 hours is Important to the people it was for.
  if (stage === "cancelled") await notifyEventCancelled(orgId, eventId, userId).catch(() => undefined);
  return { success: true };
}

/** The school's About: public events only, with nothing about who's in them (call 8). */
export async function readPublicEventsAction(schoolId: string) {
  if (!isLooseUuid(schoolId)) return DENIED;
  const { userId } = await viewer();
  const a = await getWorkspaceAccessById(schoolId, userId);
  const o = await schoolOrg(schoolId);
  if (!o || o.level !== "institution" || !a.canRead) return DENIED;
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
  const year = readSchoolYear(o.settings);
  const items = (await eventsOf([schoolId])).filter((e) => e.fields.public && e.stage !== "cancelled")
    .flatMap((e) => occurrences(e.fields, today, until, year).map((day) => ({ day, title: e.title, time: e.fields.time, place: e.fields.place, type: e.fields.type })))
    .sort((x, y) => x.day.localeCompare(y.day)).slice(0, 30);
  return { success: true as const, items, holidays: (year?.days ?? []).filter((d) => d.kind === "holiday" && d.end >= today).map((d) => ({ name: d.name, start: d.start, end: d.end })) };
}
