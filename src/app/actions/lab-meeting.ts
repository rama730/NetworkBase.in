"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { labMeetingSchema, readLabSettings } from "@/lib/organizations/lab";
import { ensureSessions } from "@/lib/organizations/lab-reading-group-server";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 35.6 (plan B6.5a, R5 calls 1–2): the lab meeting. Weekly sessions (the reading group's sessions with kind
 * "lab_meeting", so the talk's rotation skips Away and swaps need a yes); an optional updates round — one block per
 * person, Away shown as Away, never attendance; a talk; Coming up pulled from papers (R2), experiments (R4) and the
 * reading group (R3). Members only.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const DAY = 86_400_000;

async function lab(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; tz: string | null }>(sql`
    SELECT org_type AS type, org_settings AS settings, time_zone AS tz FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "research" || !a.canRead || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  return { userId, tz: w.tz || "UTC", admin: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, blocked: Boolean(a.writeBlocked), settings: readLabSettings(w.settings) };
}

/** The lab meeting (members): the next meeting with Coming up, the updates round and the talk; the next presenters; past notes. */
export async function readLabMeetingAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  const cfg = ctx.settings.labMeeting;
  if (cfg.on) await ensureSessions(orgId, ctx.settings, ctx.tz, new Date(), "lab_meeting").catch(() => undefined);
  const sessions = Array.from(await db.execute<{ id: string; starts_at: string; presenter: string | null; presenter_name: string | null; talk: string; announcements: string; notes: string; done_at: string | null;
    swap: { id: string; from: string; to: string; toName: string | null } | null }>(sql`
    SELECT r.id, r.starts_at::text, r.presenter_id AS presenter, (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = r.presenter_id) AS presenter_name,
      r.talk_title AS talk, r.announcements, r.notes, r.done_at::text,
      (SELECT jsonb_build_object('id', x.id, 'from', x.from_id, 'to', x.to_id, 'toName', (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = x.to_id))
         FROM lab_reading_swaps x WHERE x.session_id = r.id AND x.state = 'asked') AS swap
    FROM lab_reading_sessions r WHERE r.org_id = ${orgId}::uuid AND r.kind = 'lab_meeting' AND (r.done_at IS NULL AND r.starts_at > now() - interval '1 day' OR r.done_at > now() - interval '120 days')
    ORDER BY r.starts_at LIMIT 20`));
  const shape = (s: (typeof sessions)[number]) => ({ id: s.id, startsAt: new Date(s.starts_at).toISOString(), presenter: s.presenter ? { id: s.presenter, name: s.presenter_name ?? "Someone" } : null,
    talk: s.talk, announcements: s.announcements, notes: s.notes, done: Boolean(s.done_at), swap: s.swap, mine: s.presenter === ctx.userId,
    canRun: !ctx.blocked && (ctx.admin || s.presenter === ctx.userId) });
  const upcoming = sessions.filter((s) => !s.done_at).map(shape);
  const past = sessions.filter((s) => s.done_at).map(shape).reverse();
  const next = upcoming[0] ?? null;
  const people = Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 300`));
  let round: Array<{ id: string; name: string; state: "filled" | "not_filled" | "away"; sinceLast: string; next: string; stuckOn: string }> = [];
  let comingUp: { papers: Array<{ title: string; deadline: string }>; running: number; readingGroup: { at: string; title: string | null } | null } | null = null;
  if (next) {
    const blocks = new Map(Array.from(await db.execute<{ user_id: string; since_last: string; next: string; stuck_on: string }>(sql`
      SELECT user_id, since_last, next, stuck_on FROM lab_meeting_updates WHERE session_id = ${next.id}::uuid`)).map((b) => [b.user_id, b]));
    const away = new Set(Array.from(await db.execute<{ id: string }>(sql`
      SELECT DISTINCT user_id AS id FROM org_member_away WHERE org_id = ${orgId}::uuid AND starts_at < ${next.startsAt}::timestamptz + interval '2 hours' AND ends_at > ${next.startsAt}::timestamptz`)).map((r) => r.id));
    round = people.map((p) => {
      const b = blocks.get(p.id);
      return { id: p.id, name: p.name, state: b && (b.since_last || b.next || b.stuck_on) ? "filled" as const : away.has(p.id) ? "away" as const : "not_filled" as const,
        sinceLast: b?.since_last ?? "", next: b?.next ?? "", stuckOn: b?.stuck_on ?? "" };
    });
    // Coming up (call 1): paper deadlines in the next 14 days (not private ones), running experiments, the next reading group.
    const until = new Date(Date.parse(next.startsAt) + 14 * DAY).toISOString().slice(0, 10);
    const papers = Array.from(await db.execute<{ title: string; deadline: string }>(sql`
      SELECT t.title, t.type_fields->>'deadline' AS deadline FROM tasks t JOIN workspaces w ON w.id = t.workspace_id AND w.parent_id = ${orgId}::uuid AND w.deleted_at IS NULL
      WHERE t.item_type = 'paper' AND t.deleted_at IS NULL AND coalesce((t.type_fields->>'private')::boolean, false) = false AND t.stage NOT IN ('published', 'withdrawn')
        AND (t.type_fields->>'deadline') BETWEEN to_char(now(), 'YYYY-MM-DD') AND ${until} ORDER BY 2 LIMIT 10`));
    const [running] = Array.from(await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM lab_experiments e JOIN workspaces w ON w.id = e.workspace_id AND w.parent_id = ${orgId}::uuid AND w.deleted_at IS NULL WHERE e.status = 'running'`));
    const [rg] = Array.from(await db.execute<{ at: string; title: string | null }>(sql`
      SELECT r.starts_at::text AS at, (SELECT title FROM literature_sources WHERE id = r.source_id) AS title FROM lab_reading_sessions r
      WHERE r.org_id = ${orgId}::uuid AND r.kind = 'reading_group' AND r.done_at IS NULL AND r.starts_at > now() ORDER BY r.starts_at LIMIT 1`));
    comingUp = { papers, running: running?.n ?? 0, readingGroup: rg ? { at: new Date(rg.at).toISOString(), title: rg.title } : null };
  }
  return { success: true as const, me: ctx.userId, admin: ctx.admin, tz: ctx.tz, settings: cfg, people, next, upcoming, past: past.slice(0, 10), round, comingUp,
    updatesOpen: Boolean(next && Date.now() >= Date.parse(next.startsAt) - 2 * DAY) };
}

/** Set up or change the lab meeting (PI and Researchers): slot and talk rotation. Talks nobody has titled follow a new slot. */
export async function saveLabMeetingAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = labMeetingSchema.safeParse(input);
  if (!ctx?.admin) return DENIED;
  if (!parsed.success || (parsed.data.on && !parsed.data.order.length) || new Set(parsed.data.order).size !== parsed.data.order.length) return { success: false, error: "Pick a day, a time and at least one presenter." };
  const cfg = parsed.data;
  if (cfg.order.length) {
    const ok = Array.from(await db.execute<{ id: string }>(sql`
      SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role <> 'viewer' AND completed_at IS NULL AND user_id = ANY(${`{${cfg.order.join(",")}}`}::uuid[])`));
    if (ok.length !== cfg.order.length) return { success: false, error: "Presenters are people in the lab." };
  }
  const before = ctx.settings.labMeeting;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lab-reading:${orgId}`}))`);
    await tx.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{lab}', coalesce(org_settings->'lab', '{}'::jsonb) || jsonb_build_object('labMeeting', ${JSON.stringify(cfg)}::jsonb)), updated_at = now()
      WHERE id = ${orgId}::uuid`);
    if (!cfg.on || before.weekday !== cfg.weekday || before.time !== cfg.time || before.order.join() !== cfg.order.join()) {
      await tx.execute(sql`DELETE FROM lab_reading_sessions WHERE org_id = ${orgId}::uuid AND kind = 'lab_meeting' AND done_at IS NULL AND talk_title = '' AND starts_at > now()
        AND NOT EXISTS (SELECT 1 FROM lab_reading_swaps x WHERE x.session_id = lab_reading_sessions.id AND x.state = 'asked')
        AND NOT EXISTS (SELECT 1 FROM lab_meeting_updates u WHERE u.session_id = lab_reading_sessions.id)`);
    }
  });
  if (cfg.on) await ensureSessions(orgId, { ...ctx.settings, labMeeting: cfg }, ctx.tz, new Date(), "lab_meeting").catch(() => undefined);
  return { success: true };
}

const updateSchema = z.object({ sinceLast: z.string().trim().max(1000), next: z.string().trim().max(1000), stuckOn: z.string().trim().max(1000) }).strict();

/** My block in the updates round (call 2): optional, from 2 days before until the meeting is finished. Empty clears it. */
export async function saveMyUpdateAction(orgId: string, sessionId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = updateSchema.safeParse(input);
  if (!ctx || ctx.blocked || !isLooseUuid(sessionId) || !parsed.success) return DENIED;
  const [s] = Array.from(await db.execute<{ starts_at: string; done: boolean }>(sql`
    SELECT starts_at::text, done_at IS NOT NULL AS done FROM lab_reading_sessions WHERE id = ${sessionId}::uuid AND org_id = ${orgId}::uuid AND kind = 'lab_meeting'`));
  if (!s || s.done) return DENIED;
  if (Date.now() < Date.parse(s.starts_at) - 2 * DAY) return { success: false, error: "The updates box opens 2 days before the meeting." };
  const u = parsed.data;
  if (!u.sinceLast && !u.next && !u.stuckOn) await db.execute(sql`DELETE FROM lab_meeting_updates WHERE session_id = ${sessionId}::uuid AND user_id = ${ctx.userId}::uuid`);
  else await db.execute(sql`INSERT INTO lab_meeting_updates (session_id, user_id, since_last, next, stuck_on) VALUES (${sessionId}::uuid, ${ctx.userId}::uuid, ${u.sinceLast}, ${u.next}, ${u.stuckOn})
    ON CONFLICT (session_id, user_id) DO UPDATE SET since_last = EXCLUDED.since_last, next = EXCLUDED.next, stuck_on = EXCLUDED.stuck_on, updated_at = now()`);
  return { success: true };
}

const talkSchema = z.object({ talk: z.string().trim().max(200), announcements: z.string().trim().max(4000) }).strict();

/** The talk's title (its presenter or a lead) and the announcements (a lead). */
export async function saveTalkAction(orgId: string, sessionId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = talkSchema.safeParse(input);
  if (!ctx || ctx.blocked || !isLooseUuid(sessionId) || !parsed.success) return DENIED;
  const [r] = Array.from(await db.execute<{ id: string }>(sql`
    UPDATE lab_reading_sessions SET talk_title = ${parsed.data.talk}, announcements = CASE WHEN ${ctx.admin} THEN ${parsed.data.announcements} ELSE announcements END
    WHERE id = ${sessionId}::uuid AND org_id = ${orgId}::uuid AND kind = 'lab_meeting' AND done_at IS NULL AND (${ctx.admin} OR presenter_id = ${ctx.userId}::uuid) RETURNING id`));
  return r ? { success: true } : DENIED;
}
