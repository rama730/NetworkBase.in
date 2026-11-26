import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { readLabSettings, type LabSettings } from "@/lib/organizations/lab";
import { nextPresenter, nextSlots, noticesDue, pickBy } from "@/lib/organizations/lab-reading-group";

// Report 35.4 (plan B6.4b, R3 calls 6–7, layer 15): reading group upkeep and notices. Server only.

const AHEAD = 4;
const DAY_WORDS = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

/** Active people (not Viewers, not finished) of the lab, in the order's order. */
async function activeOrder(tx: typeof db, orgId: string, order: string[]) {
  if (!order.length) return [];
  const ok = new Set(Array.from(await tx.execute<{ id: string }>(sql`
    SELECT m.user_id AS id FROM workspace_members m WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL
      AND m.user_id = ANY(${`{${order.join(",")}}`}::uuid[])`)).map((r) => r.id));
  return order.filter((id) => ok.has(id));
}

/**
 * The next 4 sessions exist, each with a presenter from the rotation (call 6: after the last presenter, skipping anyone
 * Away that day or no longer in the lab). Made under a lock per lab, so two readers never make the same slot twice.
 */
export async function ensureSessions(orgId: string, settings: LabSettings, tz: string, now = new Date()) {
  const rg = settings.readingGroup;
  if (!rg.on) return;
  const slots = nextSlots(rg.weekday, rg.time, tz, now, AHEAD);
  if (!slots.length) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lab-reading:${orgId}`}))`);
    const have = new Set(Array.from(await tx.execute<{ at: string }>(sql`
      SELECT to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at FROM lab_reading_sessions WHERE org_id = ${orgId}::uuid AND starts_at >= ${slots[0]}::timestamptz`)).map((r) => r.at));
    const missing = slots.filter((s) => !have.has(s));
    if (!missing.length) return;
    const order = await activeOrder(tx as never, orgId, rg.order);
    for (const at of missing) {
      const [last] = Array.from(await tx.execute<{ id: string | null }>(sql`
        SELECT presenter_id AS id FROM lab_reading_sessions WHERE org_id = ${orgId}::uuid AND starts_at < ${at}::timestamptz AND presenter_id IS NOT NULL ORDER BY starts_at DESC LIMIT 1`));
      const away = new Set(order.length ? Array.from(await tx.execute<{ id: string }>(sql`
        SELECT DISTINCT user_id AS id FROM org_member_away WHERE org_id = ${orgId}::uuid AND starts_at < ${at}::timestamptz + interval '2 hours' AND ends_at > ${at}::timestamptz`)).map((r) => r.id) : []);
      const presenter = nextPresenter(order, last?.id ?? null, (id) => away.has(id));
      await tx.execute(sql`INSERT INTO lab_reading_sessions (org_id, starts_at, presenter_id) VALUES (${orgId}::uuid, ${at}::timestamptz, ${presenter}::uuid) ON CONFLICT DO NOTHING`);
    }
  });
}

/** Members who hear about the group (one Read before per session): active people, not Viewers. */
async function members(orgId: string) {
  return Array.from(await db.execute<{ id: string }>(sql`
    SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role <> 'viewer' AND completed_at IS NULL LIMIT 500`)).map((r) => r.id);
}

export async function tell(userIds: string[], actor: string | null, title: string, slug: string, orgId: string, key: string) {
  for (const u of new Set(userIds)) {
    if (u === actor) continue;
    await createNotification({ recipientUserId: u, actorUserId: actor, kind: "project_task_activity", category: "tasks", importance: "more", title,
      href: `/org/${encodeURIComponent(slug)}?tab=docs&view=library&lib=group`, entityRefs: { projectId: orgId, projectSlug: slug }, dedupeKey: `${key}:${u}` }).catch(() => undefined);
  }
}

/** Call 7: the one Read before notice for a session, to the lab's members, once. */
export async function sendReadBefore(sessionId: string, actor: string | null) {
  const [s] = Array.from(await db.execute<{ org: string; slug: string | null; at: string; title: string | null }>(sql`
    UPDATE lab_reading_sessions r SET read_before_at = now() FROM workspaces o
    WHERE r.id = ${sessionId}::uuid AND r.read_before_at IS NULL AND r.source_id IS NOT NULL AND o.id = r.org_id
    RETURNING r.org_id AS org, o.slug, r.starts_at::text AS at, (SELECT title FROM literature_sources WHERE id = r.source_id) AS title`));
  if (!s) return;
  await tell(await members(s.org), actor, `Read before the reading group on ${DAY_WORDS.format(new Date(s.at))}: ${s.title ?? "a paper"}`, s.slug ?? s.org, s.org, `lab-read-before:${sessionId}`);
}

/** Hourly (layer 15): make the coming sessions, tell the next presenter 7 days ahead, Pick by tomorrow, and the PI when it's late. */
export async function readingGroupNotices(now = new Date()) {
  const labs = Array.from(await db.execute<{ id: string; slug: string | null; owner: string; tz: string | null; settings: unknown }>(sql`
    SELECT id, slug, owner_id AS owner, time_zone AS tz, org_settings AS settings FROM workspaces
    WHERE kind = 'organization' AND org_type = 'research' AND deleted_at IS NULL AND deletion_scheduled_at IS NULL AND suspended_at IS NULL AND status <> 'archived'
      AND coalesce((org_settings->'lab'->'readingGroup'->>'on')::boolean, false) LIMIT 500`));
  let sent = 0;
  for (const l of labs) {
    const settings = readLabSettings(l.settings);
    await ensureSessions(l.id, settings, l.tz || "UTC", now).catch(() => undefined);
    const open = Array.from(await db.execute<{ id: string; starts_at: string; presenter: string | null; source: string | null; next_at: string | null; pick_at: string | null; late_at: string | null }>(sql`
      SELECT id, starts_at::text, presenter_id AS presenter, source_id AS source, next_notice_at::text AS next_at, pick_notice_at::text AS pick_at, late_notice_at::text AS late_at
      FROM lab_reading_sessions WHERE org_id = ${l.id}::uuid AND done_at IS NULL AND starts_at > ${now.toISOString()}::timestamptz AND starts_at < ${now.toISOString()}::timestamptz + interval '8 days'`));
    for (const s of open) {
      const due = noticesDue({ startsAt: new Date(s.starts_at).toISOString(), sourceId: s.source, nextNoticeAt: s.next_at, pickNoticeAt: s.pick_at, lateNoticeAt: s.late_at }, settings.readingGroup.pickDays, now);
      const day = DAY_WORDS.format(new Date(s.starts_at));
      const slug = l.slug ?? l.id;
      // Each notice is claimed by its own column first, so a rerun of the hour never sends it twice.
      if (due.next && s.presenter && (await claim(s.id, "next_notice_at"))) { await tell([s.presenter], null, `You present at the reading group on ${day}`, slug, l.id, `lab-rg-next:${s.id}`); sent++; }
      if (due.pickTomorrow && s.presenter && (await claim(s.id, "pick_notice_at"))) {
        await tell([s.presenter], null, `Pick the reading group paper by tomorrow (${DAY_WORDS.format(new Date(pickBy(new Date(s.starts_at).toISOString(), settings.readingGroup.pickDays)))})`, slug, l.id, `lab-rg-pick:${s.id}`); sent++;
      }
      if (due.late && (await claim(s.id, "late_notice_at"))) { await tell([l.owner], null, `The reading group on ${day} is waiting for a paper`, slug, l.id, `lab-rg-late:${s.id}`); sent++; }
    }
  }
  return { sent };
}

async function claim(id: string, column: "next_notice_at" | "pick_notice_at" | "late_notice_at") {
  const col = sql.raw(column);
  const [r] = Array.from(await db.execute<{ id: string }>(sql`UPDATE lab_reading_sessions SET ${col} = now() WHERE id = ${id}::uuid AND ${col} IS NULL RETURNING id`));
  return Boolean(r);
}
