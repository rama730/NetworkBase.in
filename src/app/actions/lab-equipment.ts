"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { validTimeZone } from "@/lib/notifications/preferences";
import { readLabSettings } from "@/lib/organizations/lab";
import { equipmentSchema, isSlot, weekBounds } from "@/lib/organizations/lab-equipment";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 35.5 (plan B6.2c, R4 calls 6–8): a lab's equipment. Members see it and book a slot (within the lab's bookable
 * hours and slot length, no overlaps, a weekly cap per person); equipment that needs training can only be booked by
 * people Trained on its protocol (server-checked). Anyone can Report a problem: it goes Out of order, booking pauses,
 * the caretaker (else the PI) gets a task, and people with bookings are told (Important). The PI and Researchers add
 * equipment; caretakers set its status. Viewers and visitors see nothing. Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function lab(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; owner: string; slug: string | null; title: string; tz: string | null; settings: unknown }>(sql`
    SELECT org_type AS type, owner_id AS owner, slug, title, time_zone AS tz, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "research" || !a.canRead || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  return { userId, owner: w.owner, slug: w.slug ?? orgId, title: w.title, tz: validTimeZone(w.tz) ?? "UTC", blocked: Boolean(a.writeBlocked),
    admin: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, rules: readLabSettings(w.settings).booking };
}

type Row = { id: string; name: string; place: string; caretaker_id: string | null; caretaker: string | null; training_doc_id: string | null; training: string | null;
  status: "available" | "out_of_order" | "maintenance"; since: string; bookable: boolean; notes: string; trained: boolean };

/** Lab Overview → Equipment (members): status, caretaker, training needed with my status, the week's bookings and mine. */
export async function readEquipmentAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  const rows = Array.from(await db.execute<Row>(sql`
    SELECT e.id, e.name, e.place, e.caretaker_id, coalesce(p.full_name, p.username) AS caretaker, e.training_doc_id,
      -- Review: a draft or leaders-only protocol's name stays with the PI and Researchers.
      CASE WHEN e.training_doc_id IS NULL AND e.needs_training THEN 'a protocol that was removed'
        WHEN ${ctx.admin} OR (coalesce(d.settings->'org'->>'lifecycle', 'published') <> 'draft' AND coalesce(d.settings->>'visibilityOverride', '') <> 'leaders_only') THEN regexp_replace(d.filename, '\\.md$', '')
        WHEN d.id IS NOT NULL THEN 'a lab protocol' END AS training,
      e.status, e.status_since::text AS since, e.bookable, e.notes,
      NOT e.needs_training OR EXISTS (SELECT 1 FROM lab_trainings t WHERE t.doc_id = e.training_doc_id AND t.user_id = ${ctx.userId}::uuid) AS trained
    FROM lab_equipment e LEFT JOIN profiles p ON p.id = e.caretaker_id LEFT JOIN workspace_documents d ON d.id = e.training_doc_id
    WHERE e.workspace_id = ${orgId}::uuid ORDER BY e.name LIMIT 200`));
  const ids = rows.map((r) => r.id);
  const bookings = ids.length ? Array.from(await db.execute<{ id: string; equipment_id: string; user_id: string; name: string | null; starts_at: string; ends_at: string }>(sql`
    SELECT b.id, b.equipment_id, b.user_id, coalesce(p.full_name, p.username) AS name, b.starts_at::text, b.ends_at::text
    FROM lab_bookings b LEFT JOIN profiles p ON p.id = b.user_id
    WHERE b.equipment_id = ANY(${`{${ids.join(",")}}`}::uuid[]) AND b.cancelled_at IS NULL AND b.ends_at > now() AND b.starts_at < now() + interval '14 days'
    ORDER BY b.starts_at LIMIT 1000`)) : [];
  const leads = ctx.admin ? Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Someone') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 300`)) : [];
  const protocols = ctx.admin ? Array.from(await db.execute<{ id: string; title: string }>(sql`
    SELECT d.id, regexp_replace(d.filename, '\\.md$', '') AS title FROM workspace_documents d WHERE d.workspace_id = ${orgId}::uuid AND d.settings->>'kind' = 'protocol' ORDER BY d.filename LIMIT 200`)) : [];
  return { success: true as const, me: ctx.userId, admin: ctx.admin, tz: ctx.tz, rules: ctx.rules, lab: ctx.title, people: leads, protocols,
    equipment: rows.map((r) => ({ id: r.id, name: r.name, place: r.place, caretakerId: r.caretaker_id, caretaker: r.caretaker, trainingDocId: r.training_doc_id, training: r.training,
      status: r.status, since: r.since, bookable: r.bookable, notes: r.notes, trained: r.trained,
      canSetStatus: !ctx.blocked && (ctx.admin || r.caretaker_id === ctx.userId),
      bookings: bookings.filter((b) => b.equipment_id === r.id).map((b) => ({ id: b.id, mine: b.user_id === ctx.userId, name: b.user_id === ctx.userId || ctx.admin || r.caretaker_id === ctx.userId ? b.name ?? "Someone" : "Booked", start: b.starts_at, end: b.ends_at })) })) };
}

/** Add or edit equipment (the PI and Researchers): caretaker and trainers are people in the lab; training is a lab protocol. */
export async function saveEquipmentAction(orgId: string, id: string | null, input: unknown): Promise<{ success: true; id: string } | Failure> {
  const ctx = await lab(orgId);
  const parsed = equipmentSchema.safeParse(input);
  if (!ctx?.admin || (id !== null && !isLooseUuid(id))) return DENIED;
  if (!parsed.success) return { success: false, error: "Equipment needs a name." };
  const e = parsed.data;
  if (e.caretakerId) {
    const [ok] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${e.caretakerId}::uuid AND role <> 'viewer' AND completed_at IS NULL`));
    if (!ok) return { success: false, error: "The caretaker is someone in the lab." };
  }
  if (e.trainingDocId) {
    const [ok] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspace_documents WHERE id = ${e.trainingDocId}::uuid AND workspace_id = ${orgId}::uuid AND settings->>'kind' = 'protocol'`));
    if (!ok) return { success: false, error: "Training is one of the lab’s protocols." };
  }
  const [row] = id
    ? Array.from(await db.execute<{ id: string }>(sql`
        UPDATE lab_equipment SET name = ${e.name}, place = ${e.place}, caretaker_id = ${e.caretakerId}::uuid, training_doc_id = ${e.trainingDocId}::uuid, needs_training = ${Boolean(e.trainingDocId)},
          bookable = ${e.bookable}, notes = ${e.notes}, updated_at = now()
        WHERE id = ${id}::uuid AND workspace_id = ${orgId}::uuid RETURNING id`))
    : Array.from(await db.execute<{ id: string }>(sql`
        INSERT INTO lab_equipment (workspace_id, name, place, caretaker_id, training_doc_id, needs_training, bookable, notes)
        VALUES (${orgId}::uuid, ${e.name}, ${e.place}, ${e.caretakerId}::uuid, ${e.trainingDocId}::uuid, ${Boolean(e.trainingDocId)}, ${e.bookable}, ${e.notes}) RETURNING id`));
  return row ? { success: true, id: row.id } : DENIED;
}

/** Book a slot (members): Available and bookable, trained if it needs it, on the lab's grid, free, and within my weekly cap. */
export async function bookEquipmentAction(orgId: string, equipmentId: string, startIso: string): Promise<{ success: true; id: string; start: string; end: string } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx || ctx.blocked || !isLooseUuid(equipmentId) || typeof startIso !== "string" || Number.isNaN(Date.parse(startIso))) return DENIED;
  const slot = isSlot(startIso, ctx.rules, ctx.tz);
  if (!slot) return { success: false, error: "Pick one of the slots shown." };
  if (Date.parse(slot.end) <= Date.now()) return { success: false, error: "That slot has passed." };
  if (Date.parse(slot.start) > Date.now() + 60 * 864e5) return { success: false, error: "Book up to 60 days ahead." };
  const week = weekBounds(slot.start, ctx.tz);
  const result = await db.transaction(async (tx) => {
    // One booking at a time per equipment, and one per person's week (call 7).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lab-equipment:${equipmentId}`}))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lab-booker:${orgId}:${ctx.userId}`}))`);
    const [e] = Array.from(await tx.execute<{ status: string; bookable: boolean; trained: boolean }>(sql`
      SELECT e.status, e.bookable, NOT e.needs_training OR EXISTS (SELECT 1 FROM lab_trainings t WHERE t.doc_id = e.training_doc_id AND t.user_id = ${ctx.userId}::uuid) AS trained
      FROM lab_equipment e WHERE e.id = ${equipmentId}::uuid AND e.workspace_id = ${orgId}::uuid FOR SHARE OF e`));
    if (!e) return { error: DENIED.error };
    if (!e.bookable) return { error: "This equipment isn’t booked: just use it." };
    if (e.status !== "available") return { error: "Booking is paused while it’s Out of order or in Maintenance." };
    // Call 6: equipment that needs training can't be booked untrained.
    if (!e.trained) return { error: "Book it once a trainer signs you off on its protocol." };
    const [clash] = Array.from(await tx.execute<{ ok: boolean }>(sql`
      SELECT true AS ok FROM lab_bookings WHERE equipment_id = ${equipmentId}::uuid AND cancelled_at IS NULL AND starts_at < ${slot.end}::timestamptz AND ends_at > ${slot.start}::timestamptz LIMIT 1`));
    if (clash) return { error: "Someone booked that slot. Pick another." };
    const [used] = Array.from(await tx.execute<{ minutes: number }>(sql`
      SELECT coalesce(sum(extract(epoch FROM (b.ends_at - b.starts_at)) / 60), 0)::int AS minutes FROM lab_bookings b JOIN lab_equipment e ON e.id = b.equipment_id
      WHERE e.workspace_id = ${orgId}::uuid AND b.user_id = ${ctx.userId}::uuid AND b.cancelled_at IS NULL AND b.starts_at >= ${week.start}::timestamptz AND b.starts_at < ${week.end}::timestamptz`));
    if ((used?.minutes ?? 0) + ctx.rules.slotMinutes > ctx.rules.weeklyCapHours * 60) return { error: `You’ve booked your ${ctx.rules.weeklyCapHours} hours this week. The next slot opens next week.` };
    const [b] = Array.from(await tx.execute<{ id: string }>(sql`
      INSERT INTO lab_bookings (equipment_id, user_id, starts_at, ends_at) VALUES (${equipmentId}::uuid, ${ctx.userId}::uuid, ${slot.start}::timestamptz, ${slot.end}::timestamptz) RETURNING id`));
    return { id: b!.id };
  });
  return "error" in result ? { success: false, error: result.error! } : { success: true, id: result.id, start: slot.start, end: slot.end };
}

/** Cancel a booking (the person who booked, the caretaker, the PI and Researchers). */
export async function cancelBookingAction(orgId: string, bookingId: string): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx || ctx.blocked || !isLooseUuid(bookingId)) return DENIED;
  const done = Array.from(await db.execute(sql`
    UPDATE lab_bookings b SET cancelled_at = now() FROM lab_equipment e
    WHERE b.id = ${bookingId}::uuid AND e.id = b.equipment_id AND e.workspace_id = ${orgId}::uuid AND b.cancelled_at IS NULL AND b.starts_at > now()
      AND (b.user_id = ${ctx.userId}::uuid OR e.caretaker_id = ${ctx.userId}::uuid OR ${ctx.admin}) RETURNING b.id`));
  return done.length ? { success: true } : DENIED;
}

const reportSchema = z.string().trim().min(1).max(1000);

/** Report a problem (any member, call 8): Out of order, booking pauses, the caretaker (else the PI) gets a task, bookers are told. */
export async function reportEquipmentProblemAction(orgId: string, equipmentId: string, body: unknown): Promise<{ success: true; to?: "caretaker" | "pi" } | Failure> {
  const ctx = await lab(orgId);
  const parsed = reportSchema.safeParse(body);
  if (!ctx || ctx.blocked || !isLooseUuid(equipmentId)) return DENIED;
  if (!parsed.success) return { success: false, error: "Say what’s wrong." };
  const { insertTask } = await import("@/lib/organizations/assignments");
  const out = await db.transaction(async (tx) => {
    const [e] = Array.from(await tx.execute<{ name: string; caretaker: string | null }>(sql`
      UPDATE lab_equipment SET status = 'out_of_order', status_since = CASE WHEN status = 'out_of_order' THEN status_since ELSE now() END, updated_at = now()
      WHERE id = ${equipmentId}::uuid AND workspace_id = ${orgId}::uuid RETURNING name,
        (SELECT m.user_id::text FROM workspace_members m WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = lab_equipment.caretaker_id AND m.role <> 'viewer' AND m.completed_at IS NULL) AS caretaker`));
    if (!e) return null;
    const assignee = e.caretaker ?? ctx.owner;
    // Review: while a report is open, more reports join it — no new task, no new notices to the caretaker.
    const [open] = Array.from(await tx.execute<{ id: string; task_id: string | null }>(sql`
      SELECT id, task_id FROM lab_equipment_reports WHERE equipment_id = ${equipmentId}::uuid AND fixed_at IS NULL ORDER BY created_at LIMIT 1`));
    if (open) {
      await tx.execute(sql`INSERT INTO lab_equipment_reports (equipment_id, reporter_id, body, task_id) VALUES (${equipmentId}::uuid, ${ctx.userId}::uuid, ${parsed.data}, ${open.task_id}::uuid)`);
      return { name: e.name, assignee, booked: [] as string[], reportId: open.id, again: true };
    }
    const taskId = await insertTask(tx as never, { projectId: orgId, title: `Fix ${e.name}`.slice(0, 200), description: `Reported: ${parsed.data}`.slice(0, 2000),
      dueDate: null, sprintId: null, assigneeId: assignee, creatorId: ctx.userId, kind: "task", assignmentId: null, assignmentSettings: null, teamName: null });
    const [rep] = Array.from(await tx.execute<{ id: string }>(sql`INSERT INTO lab_equipment_reports (equipment_id, reporter_id, body, task_id) VALUES (${equipmentId}::uuid, ${ctx.userId}::uuid, ${parsed.data}, ${taskId}::uuid) RETURNING id`));
    const booked = Array.from(await tx.execute<{ user_id: string }>(sql`
      SELECT DISTINCT b.user_id FROM lab_bookings b JOIN workspace_members m ON m.workspace_id = ${orgId}::uuid AND m.user_id = b.user_id AND m.role <> 'viewer' AND m.completed_at IS NULL
      WHERE b.equipment_id = ${equipmentId}::uuid AND b.cancelled_at IS NULL AND b.ends_at > now()`));
    return { name: e.name, assignee, booked: booked.map((b) => b.user_id), reportId: rep!.id, again: false };
  });
  if (!out) return DENIED;
  if (out.again) return { success: true };
  const to = out.assignee === ctx.owner && !(await db.execute(sql`SELECT 1 FROM lab_equipment WHERE id = ${equipmentId}::uuid AND caretaker_id = ${ctx.owner}::uuid`)).length ? "pi" as const : "caretaker" as const;
  const href = `/org/${encodeURIComponent(ctx.slug)}`;
  if (out.assignee !== ctx.userId) {
    await createNotification({ recipientUserId: out.assignee, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
      title: `${out.name} is Out of order: ${parsed.data.slice(0, 80)}`, href, entityRefs: { projectId: orgId, projectSlug: ctx.slug }, dedupeKey: `lab-report:${equipmentId}:${out.reportId}` }).catch(() => undefined);
  }
  for (const u of out.booked) {
    if (u === ctx.userId) continue;
    await createNotification({ recipientUserId: u, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "important",
      title: `${out.name}, which you booked, is Out of order`, href, entityRefs: { projectId: orgId, projectSlug: ctx.slug }, dedupeKey: `lab-report-booked:${equipmentId}:${u}:${out.reportId}` }).catch(() => undefined);
  }
  return { success: true, to };
}

/** Set the status (the caretaker, the PI and Researchers): Fixed → Available reopens booking and closes open reports. */
export async function setEquipmentStatusAction(orgId: string, equipmentId: string, status: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = z.enum(["available", "out_of_order", "maintenance"]).safeParse(status);
  if (!ctx || ctx.blocked || !isLooseUuid(equipmentId) || !parsed.success) return DENIED;
  const done = Array.from(await db.execute(sql`
    UPDATE lab_equipment SET status = ${parsed.data}, status_since = now(), updated_at = now()
    WHERE id = ${equipmentId}::uuid AND workspace_id = ${orgId}::uuid AND (${ctx.admin} OR caretaker_id = ${ctx.userId}::uuid) RETURNING id`));
  if (!done.length) return DENIED;
  if (parsed.data === "available") await db.execute(sql`UPDATE lab_equipment_reports SET fixed_at = now() WHERE equipment_id = ${equipmentId}::uuid AND fixed_at IS NULL`);
  return { success: true };
}
