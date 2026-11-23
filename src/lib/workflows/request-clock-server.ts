import "server-only";

import { sql } from "drizzle-orm";

import { wakeChatDueIfSoon } from "@/inngest/wake";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { clockState, DEFAULT_HOURS, reminderTimes, workingHoursSchema, type ClockInput, type WorkingHours } from "@/lib/workflows/request-clock";
import { readRequestTypes } from "@/lib/workflows/request-store";
import type { RequestType } from "@/lib/workflows/requests";

/**
 * Report 38.7 W7 and call 6 (plan A2.5): a request's clock. While it's New the first-reply clock runs from when it was
 * asked; once accepted the deliver clock runs from acceptedAt until Delivered. Warnings are system rows in
 * task_reminders (note "request_clock:<clock>:<80|breach>") fired by the hourly chat-due job: no new scheduled job.
 */
export const CLOCK_NOTE = "request_clock:";
const OPEN_DELIVER = ["accepted", "in_progress", "in_review"];

export async function readWorkingHours(workspaceId: string): Promise<{ hours: WorkingHours; tz: string; set: boolean }> {
  const [row] = Array.from(await db.execute<{ hours: unknown; tz: string | null }>(sql`
    SELECT workflow_settings->'workingHours' AS hours, time_zone AS tz FROM workspaces WHERE id = ${workspaceId}::uuid`));
  const parsed = workingHoursSchema.safeParse(row?.hours);
  return { hours: parsed.success ? parsed.data : DEFAULT_HOURS, tz: validZone(row?.tz) ?? "UTC", set: parsed.success };
}

export function validZone(tz: string | null | undefined) {
  if (!tz) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return null; }
}

type Req = { id: string; stage: string | null; created_at: Date; type_fields: Record<string, unknown> | null; assignee_id: string | null; workspace_id: string };

/** Which clock runs for a request, as clockState's input (null when none applies). */
export function clockFor(r: Pick<Req, "stage" | "created_at" | "type_fields">, type: RequestType | undefined, hours: WorkingHours, tz: string): (ClockInput & { kind: "first" | "deliver" }) | null {
  if (!type) return null;
  const f = r.type_fields ?? {};
  const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);
  const waiting = f.waiting && typeof f.waiting === "object" ? date((f.waiting as { since?: string }).since) : null;
  const paused = typeof f.pausedMinutes === "number" ? f.pausedMinutes : 0;
  if (r.stage === "new" && type.firstReplyMinutes) {
    return { kind: "first", startedAt: new Date(r.created_at), budgetMinutes: type.firstReplyMinutes, pausedMinutes: 0, waitingSince: null, stoppedAt: date(f.firstRepliedAt), hours, tz };
  }
  const accepted = date(f.acceptedAt);
  if (accepted && type.deliverMinutes && (OPEN_DELIVER.includes(r.stage ?? "") || r.stage === "delivered")) {
    return { kind: "deliver", startedAt: accepted, budgetMinutes: type.deliverMinutes, pausedMinutes: paused, waitingSince: waiting, stoppedAt: r.stage === "delivered" ? date(f.deliveredAt) ?? new Date() : null, hours, tz };
  }
  return null;
}

/** The clock as the views show it. */
export function requestClock(r: Pick<Req, "stage" | "created_at" | "type_fields">, type: RequestType | undefined, hours: WorkingHours, tz: string, now = new Date()) {
  const input = clockFor(r, type, hours, tz);
  return input ? { kind: input.kind, ...clockState({ ...input, now }) } : null;
}

type Exec = Pick<typeof db, "execute">;
async function triagers(exec: Exec, workspaceId: string, type: RequestType) {
  const rows = Array.from(await exec.execute<{ id: string; role: string }>(sql`
    SELECT owner_id AS id, 'owner' AS role FROM workspaces WHERE id = ${workspaceId}::uuid
    UNION SELECT user_id, role FROM workspace_members WHERE workspace_id = ${workspaceId}::uuid`));
  const leaders = rows.filter((p) => p.role === "owner" || p.role === "admin").map((p) => p.id);
  const chosen = type.triagerIds.length ? rows.filter((p) => type.triagerIds.includes(p.id)).map((p) => p.id) : leaders;
  return { chosen, leaders };
}

/**
 * Recalculate one request's warnings: drop the unsent ones and write what its clock needs now. One at a time per
 * request (the row is locked) so two changes landing together can't leave a warning twice; the workspace's types and
 * hours are read first, so the locked part uses its one connection only (no waiting on the pool while holding it).
 */
export async function scheduleRequestClock(taskId: string, ctx?: { types?: RequestType[]; hours?: WorkingHours; tz?: string }) {
  try {
    const [base] = Array.from(await db.execute<{ workspace_id: string }>(sql`SELECT workspace_id FROM tasks WHERE id = ${taskId}::uuid`));
    const types = base ? ctx?.types ?? await readRequestTypes(base.workspace_id) : [];
    const { hours, tz } = base ? (ctx?.hours && ctx.tz ? { hours: ctx.hours, tz: ctx.tz } : await readWorkingHours(base.workspace_id)) : { hours: DEFAULT_HOURS, tz: "UTC" };
    const first = await db.transaction(async (tx) => {
      const [r] = Array.from(await tx.execute<Req>(sql`
        SELECT id, stage, created_at, type_fields, assignee_id, workspace_id FROM tasks
        WHERE id = ${taskId}::uuid AND item_type = 'request' AND deleted_at IS NULL FOR UPDATE`));
      await tx.execute(sql`DELETE FROM task_reminders WHERE task_id = ${taskId}::uuid AND sent_at IS NULL AND note LIKE ${`${CLOCK_NOTE}%`}`);
      if (!r) return null;
      const type = types.find((t) => t.id === (r.type_fields ?? {}).requestTypeId);
      const input = clockFor(r, type, hours, tz);
      const times = input ? reminderTimes(input) : null;
      if (!input || !times || !type) return null;
      const { chosen, leaders } = await triagers(tx, r.workspace_id, type);
      // W7.2: 80 % → the handler (the triage people before it's accepted); breached → the handler, then owners and admins.
      const handler = input.kind === "deliver" && r.assignee_id ? [r.assignee_id] : chosen;
      const rows = [
        ...handler.map((userId) => ({ userId, at: times.soonAt, note: `${CLOCK_NOTE}${input.kind}:80` })),
        ...[...new Set([...handler, ...leaders])].map((userId) => ({ userId, at: times.breachAt, note: `${CLOCK_NOTE}${input.kind}:breach` })),
      ].filter((x) => x.at.getTime() > Date.now());
      for (const x of rows) await tx.execute(sql`INSERT INTO task_reminders (task_id, user_id, remind_at, note) VALUES (${taskId}::uuid, ${x.userId}::uuid, ${x.at.toISOString()}::timestamptz, ${x.note})`);
      return rows.map((x) => x.at).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    });
    if (first) await wakeChatDueIfSoon(first);
  } catch (error) {
    logger.error("requests.clock_schedule_failed", { module: "tasks", taskId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** W10.2: working hours or a type's times changed: every open request in the workspace is recalculated from its start. */
export async function rescheduleWorkspaceClocks(workspaceId: string) {
  const ids = Array.from(await db.execute<{ id: string }>(sql`
    SELECT id FROM tasks WHERE workspace_id = ${workspaceId}::uuid AND item_type = 'request' AND deleted_at IS NULL
      AND stage IN ('new', 'accepted', 'in_progress', 'in_review') LIMIT 2000`));
  const types = await readRequestTypes(workspaceId);
  const { hours, tz } = await readWorkingHours(workspaceId);
  for (const { id } of ids) await scheduleRequestClock(id, { types, hours, tz });
  return ids.length;
}

/** The words of a fired warning; null when the request no longer has that clock running (it was answered or delivered). */
export function clockNoticeTitle(note: string, title: string, stage: string | null) {
  const [, kind, mark] = note.split(":");
  if (kind === "first" && stage !== "new") return null;
  if (kind === "deliver" && !OPEN_DELIVER.includes(stage ?? "")) return null;
  return mark === "breach" ? `Breached: ${title}` : `Breaching soon: ${title}`;
}
