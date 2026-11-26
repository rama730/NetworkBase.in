"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { readingGroupSchema, readLabSettings } from "@/lib/organizations/lab";
import { pickBy, sessionState } from "@/lib/organizations/lab-reading-group";
import { ensureSessions, sendReadBefore, tell } from "@/lib/organizations/lab-reading-group-server";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 35.4 (plan B6.4b, R3 calls 6–7): the lab's reading group for its members. The PI and Researchers set the slot
 * and the presenter order; the presenter (or a lead) picks the paper and finishes the session; a swap needs the other
 * person's yes. Members suggest sources. Nothing here counts who read or presented most.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const DAY_WORDS = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

async function lab(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; tz: string | null; slug: string | null; owner: string }>(sql`
    SELECT org_type AS type, org_settings AS settings, time_zone AS tz, slug, owner_id AS owner FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "research" || !a.canRead || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  return { userId, owner: w.owner, slug: w.slug ?? orgId, tz: w.tz || "UTC", admin: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, blocked: Boolean(a.writeBlocked), settings: readLabSettings(w.settings) };
}

/** An open session of this lab, locked for a change. */
async function sessionOf(tx: typeof db, orgId: string, id: string) {
  if (!isLooseUuid(id)) return null;
  const [s] = Array.from(await tx.execute<{ id: string; kind: "reading_group" | "lab_meeting"; presenter: string | null; source: string | null; starts_at: string; done_at: string | null }>(sql`
    SELECT id, kind, presenter_id AS presenter, source_id AS source, starts_at::text, done_at::text FROM lab_reading_sessions WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid FOR UPDATE`));
  return s ?? null;
}

const activeMember = (orgId: string, userId: string) => sql`EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = ${userId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL)`;

/** The reading group (members): the slot, the next sessions with presenter, paper and pick-by, past sessions, suggestions, open swaps. */
export async function readReadingGroupAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  const rg = ctx.settings.readingGroup;
  if (rg.on) await ensureSessions(orgId, ctx.settings, ctx.tz, new Date(), "reading_group").catch(() => undefined);
  const sessions = Array.from(await db.execute<{ id: string; starts_at: string; presenter: string | null; presenter_name: string | null; source: string | null; title: string | null;
    notes: string; done_at: string | null; read_before_at: string | null; swap: { id: string; from: string; to: string; toName: string | null } | null }>(sql`
    SELECT r.id, r.starts_at::text, r.presenter_id AS presenter, (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = r.presenter_id) AS presenter_name,
      r.source_id AS source, (SELECT title FROM literature_sources WHERE id = r.source_id) AS title, r.notes, r.done_at::text, r.read_before_at::text,
      (SELECT jsonb_build_object('id', x.id, 'from', x.from_id, 'to', x.to_id, 'toName', (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = x.to_id))
         FROM lab_reading_swaps x WHERE x.session_id = r.id AND x.state = 'asked') AS swap
    FROM lab_reading_sessions r WHERE r.org_id = ${orgId}::uuid AND r.kind = 'reading_group' AND (r.done_at IS NULL AND r.starts_at > now() - interval '1 day' OR r.done_at > now() - interval '120 days')
    ORDER BY r.starts_at LIMIT 30`));
  const people = Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 300`));
  const sources = Array.from(await db.execute<{ id: string; title: string; suggested: boolean; suggested_by: string | null }>(sql`
    SELECT s.id, s.title, s.suggested_by IS NOT NULL AS suggested, (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = s.suggested_by) AS suggested_by
    FROM literature_sources s WHERE s.workspace_id = ${orgId}::uuid ORDER BY (s.suggested_by IS NULL), s.suggested_at DESC NULLS LAST, s.created_at DESC LIMIT 300`));
  const shaped = sessions.map((s) => {
    const startsAt = new Date(s.starts_at).toISOString();
    return { id: s.id, startsAt, presenter: s.presenter ? { id: s.presenter, name: s.presenter_name ?? "Someone" } : null, source: s.source ? { id: s.source, title: s.title ?? "A source" } : null,
      notes: s.notes, state: sessionState({ doneAt: s.done_at, sourceId: s.source }), pickBy: pickBy(startsAt, rg.pickDays), readBefore: Boolean(s.read_before_at),
      swap: s.swap, mine: s.presenter === ctx.userId, canRun: !ctx.blocked && (ctx.admin || s.presenter === ctx.userId) };
  });
  return { success: true as const, me: ctx.userId, admin: ctx.admin, settings: rg, tz: ctx.tz, people,
    upcoming: shaped.filter((s) => s.state !== "done"), past: shaped.filter((s) => s.state === "done").reverse(),
    suggestions: sources.filter((s) => s.suggested).map((s) => ({ id: s.id, title: s.title, by: s.suggested_by })), sources: sources.map((s) => ({ id: s.id, title: s.title })) };
}

/** Start or change the reading group (PI and Researchers): slot, presenter order, pick-by days. Unpicked future sessions follow a new slot. */
export async function saveReadingGroupAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = readingGroupSchema.safeParse(input);
  if (!ctx?.admin) return DENIED;
  if (!parsed.success) return { success: false, error: "Pick a day, a time and at least one presenter." };
  const rg = parsed.data;
  if (rg.on && !rg.order.length) return { success: false, error: "Pick a day, a time and at least one presenter." };
  if (new Set(rg.order).size !== rg.order.length) return DENIED;
  if (rg.order.length) {
    const ok = Array.from(await db.execute<{ id: string }>(sql`
      SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND role <> 'viewer' AND completed_at IS NULL AND user_id = ANY(${`{${rg.order.join(",")}}`}::uuid[])`));
    if (ok.length !== rg.order.length) return { success: false, error: "Presenters are people in the lab." };
  }
  const before = ctx.settings.readingGroup;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`lab-reading:${orgId}`}))`);
    await tx.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{lab}', coalesce(org_settings->'lab', '{}'::jsonb) || jsonb_build_object('readingGroup', ${JSON.stringify(rg)}::jsonb)), updated_at = now()
      WHERE id = ${orgId}::uuid`);
    // A new slot, order or switch-off: open sessions nobody has picked a paper for are made again (or dropped).
    if (!rg.on || before.weekday !== rg.weekday || before.time !== rg.time || before.order.join() !== rg.order.join()) {
      await tx.execute(sql`DELETE FROM lab_reading_sessions WHERE org_id = ${orgId}::uuid AND kind = 'reading_group' AND done_at IS NULL AND source_id IS NULL AND starts_at > now()
        AND NOT EXISTS (SELECT 1 FROM lab_reading_swaps x WHERE x.session_id = lab_reading_sessions.id AND x.state = 'asked')`);
    }
  });
  if (rg.on) await ensureSessions(orgId, { ...ctx.settings, readingGroup: rg }, ctx.tz, new Date(), "reading_group").catch(() => undefined);
  return { success: true };
}

/** Pick the paper (the presenter, or a lead): a source in the library; the first pick sends the one Read before notice. */
export async function pickReadingAction(orgId: string, sessionId: string, sourceId: string): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx || ctx.blocked || !isLooseUuid(sourceId)) return DENIED;
  const ok = await db.transaction(async (tx) => {
    const s = await sessionOf(tx as never, orgId, sessionId);
    if (!s || s.done_at || s.kind !== "reading_group" || !(ctx.admin || s.presenter === ctx.userId)) return false;
    const [src] = Array.from(await tx.execute<{ id: string }>(sql`SELECT id FROM literature_sources WHERE id = ${sourceId}::uuid AND workspace_id = ${orgId}::uuid`));
    if (!src) return false;
    await tx.execute(sql`UPDATE lab_reading_sessions SET source_id = ${sourceId}::uuid WHERE id = ${sessionId}::uuid`);
    return true;
  });
  if (!ok) return DENIED;
  await sendReadBefore(sessionId, ctx.userId);
  return { success: true };
}

/** Swap with (the presenter): asks a colleague, who must say yes (call 6). One open ask per session. */
export async function askSwapAction(orgId: string, sessionId: string, toId: string): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx || ctx.blocked || !isLooseUuid(toId) || toId === ctx.userId) return DENIED;
  const out = await db.transaction(async (tx) => {
    const s = await sessionOf(tx as never, orgId, sessionId);
    if (!s || s.done_at || s.presenter !== ctx.userId) return "denied";
    const [ok] = Array.from(await tx.execute<{ ok: boolean }>(sql`SELECT ${activeMember(orgId, toId)} AS ok`));
    if (!ok?.ok) return "denied";
    const [made] = Array.from(await tx.execute<{ id: string }>(sql`
      INSERT INTO lab_reading_swaps (session_id, from_id, to_id) VALUES (${sessionId}::uuid, ${ctx.userId}::uuid, ${toId}::uuid) ON CONFLICT DO NOTHING RETURNING id`));
    return made ? { at: s.starts_at, kind: s.kind } : "open";
  });
  if (out === "open") return { success: false, error: "A swap is already waiting for an answer." };
  if (out === "denied") return DENIED;
  const meeting = out.kind === "lab_meeting";
  await tell([toId], ctx.userId, meeting ? `Can you give the talk at the lab meeting on ${DAY_WORDS.format(new Date(out.at))}? Answer on the lab’s Overview.` : `Can you present at the reading group on ${DAY_WORDS.format(new Date(out.at))}? Answer in the Library.`,
    ctx.slug, orgId, `lab-rg-swap:${sessionId}:${Date.now()}`, meeting ? "" : undefined);
  return { success: true };
}

/** Answer a swap (the person asked): yes takes the session, and gives them your next session in return if you have one. */
export async function answerSwapAction(orgId: string, swapId: string, accept: boolean): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx || ctx.blocked || !isLooseUuid(swapId) || typeof accept !== "boolean") return DENIED;
  const out = await db.transaction(async (tx) => {
    const [x] = Array.from(await tx.execute<{ session: string; from: string; to: string }>(sql`
      SELECT x.session_id AS session, x.from_id AS from, x.to_id AS to FROM lab_reading_swaps x JOIN lab_reading_sessions r ON r.id = x.session_id AND r.org_id = ${orgId}::uuid
      WHERE x.id = ${swapId}::uuid AND x.state = 'asked' FOR UPDATE OF x`));
    if (!x || x.to !== ctx.userId) return null;
    const s = await sessionOf(tx as never, orgId, x.session);
    if (!s || s.done_at || s.presenter !== x.from) {
      await tx.execute(sql`UPDATE lab_reading_swaps SET state = 'withdrawn', answered_at = now() WHERE id = ${swapId}::uuid`);
      return "stale" as const;
    }
    await tx.execute(sql`UPDATE lab_reading_swaps SET state = ${accept ? "accepted" : "declined"}, answered_at = now() WHERE id = ${swapId}::uuid`);
    if (accept) {
      const [mine] = Array.from(await tx.execute<{ id: string }>(sql`
        SELECT id FROM lab_reading_sessions WHERE org_id = ${orgId}::uuid AND kind = ${s.kind} AND presenter_id = ${ctx.userId}::uuid AND done_at IS NULL AND starts_at > ${s.starts_at}::timestamptz ORDER BY starts_at LIMIT 1 FOR UPDATE`));
      await tx.execute(sql`UPDATE lab_reading_sessions SET presenter_id = ${ctx.userId}::uuid, next_notice_at = NULL, pick_notice_at = NULL WHERE id = ${x.session}::uuid`);
      if (mine) await tx.execute(sql`UPDATE lab_reading_sessions SET presenter_id = ${x.from}::uuid, next_notice_at = NULL, pick_notice_at = NULL WHERE id = ${mine.id}::uuid`);
    }
    return { from: x.from, at: s.starts_at, kind: s.kind };
  });
  if (out === "stale") return { success: false, error: "That swap no longer applies." };
  if (!out) return DENIED;
  const what = out.kind === "lab_meeting" ? "lab meeting talk" : "reading group";
  await tell([out.from], ctx.userId, `Your ${what} swap for ${DAY_WORDS.format(new Date(out.at))} was ${accept ? "accepted" : "declined"}`, ctx.slug, orgId, `lab-rg-swap-answer:${swapId}`, out.kind === "lab_meeting" ? "" : undefined);
  return { success: true };
}

/** Finish a session with its discussion notes (the presenter, or a lead). The next session already waits in the rotation. */
export async function finishReadingAction(orgId: string, sessionId: string, notes: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx || ctx.blocked || typeof notes !== "string" || notes.length > 20000) return DENIED;
  const ok = await db.transaction(async (tx) => {
    const s = await sessionOf(tx as never, orgId, sessionId);
    if (!s || s.done_at || !(ctx.admin || s.presenter === ctx.userId) || Date.parse(s.starts_at) > Date.now()) return false;
    await tx.execute(sql`UPDATE lab_reading_sessions SET done_at = now(), notes = ${notes.trim()} WHERE id = ${sessionId}::uuid`);
    await tx.execute(sql`UPDATE lab_reading_swaps SET state = 'withdrawn', answered_at = now() WHERE session_id = ${sessionId}::uuid AND state = 'asked'`);
    return true;
  });
  return ok ? { success: true } : { success: false, error: "A session is finished once it has started, by its presenter or a lead." };
}

/** Add to lab notes: the session's notes go under the source's Key findings, signed by whoever adds them. */
export async function addSessionToLabNotesAction(orgId: string, sessionId: string): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx || ctx.blocked || !isLooseUuid(sessionId)) return DENIED;
  const [s] = Array.from(await db.execute<{ source: string | null; notes: string; at: string; done: boolean }>(sql`
    SELECT source_id AS source, notes, starts_at::text AS at, done_at IS NOT NULL AS done FROM lab_reading_sessions WHERE id = ${sessionId}::uuid AND org_id = ${orgId}::uuid`));
  if (!s?.done || !s.source || !s.notes) return DENIED;
  const line = `Reading group, ${DAY_WORDS.format(new Date(s.at))}: ${s.notes}`;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM literature_sources WHERE id = ${s.source}::uuid FOR UPDATE`);
    await tx.execute(sql`INSERT INTO lab_source_notes (source_id, section, body, author_id) VALUES (${s.source}::uuid, 'findings', ${line.slice(0, 5000)}, ${ctx.userId}::uuid)
      ON CONFLICT (source_id, section) DO UPDATE SET body = left(lab_source_notes.body || E'\\n\\n' || EXCLUDED.body, 5000), author_id = EXCLUDED.author_id, updated_at = now()`);
  });
  return { success: true };
}

/** Suggest for reading group (members), or take the suggestion back. */
export async function suggestSourceAction(orgId: string, sourceId: string, on: boolean): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx || ctx.blocked || !isLooseUuid(sourceId) || typeof on !== "boolean") return DENIED;
  const [r] = Array.from(await db.execute<{ id: string }>(sql`
    UPDATE literature_sources SET suggested_by = ${on ? ctx.userId : null}::uuid, suggested_at = ${on ? new Date().toISOString() : null}::timestamptz
    WHERE id = ${sourceId}::uuid AND workspace_id = ${orgId}::uuid ${on ? sql`` : sql`AND (suggested_by = ${ctx.userId}::uuid OR ${ctx.admin})`} RETURNING id`));
  return r ? { success: true } : DENIED;
}
