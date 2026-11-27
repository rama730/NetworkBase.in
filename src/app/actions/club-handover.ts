"use server";

import { sql } from "drizzle-orm";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { checklistOpen, handoverSchema, HANDOVER_ITEMS, readHandover, readPositions } from "@/lib/organizations/club";
import { moveWork, notifyAll } from "@/lib/organizations/club-server";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 36.3 (plan B7.2c, L2 call 10): the yearly handover. The President sets the incoming Season and the handover
 * date; each outgoing officer has a checklist of five on their term (role page, open tasks, documents, accounts by name,
 * the Handover meeting); moving work hands their open tasks and documents to the incoming officer. On the date the
 * hourly job switches roles (club-server handoverSteps). Seen by the President and the officers in it.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const TICKABLE = ["role_page", "accounts", "meeting"] as const;

async function club(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; slug: string | null; title: string }>(sql`
    SELECT org_type AS type, org_settings AS settings, slug, title FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "club" || !a.canRead || !(a.isOwner || a.isMember)) return null;
  return { userId, w, president: a.isOwner && !a.writeBlocked, blocked: Boolean(a.writeBlocked), committee: readPositions(w.settings), handover: readHandover(w.settings) };
}

type Term = { id: string; position_id: string; season: string; user_id: string | null; holder_name: string; state: string; handover: Record<string, boolean> };

/** The handover (the President and the officers in it): the date, and each position's outgoing and incoming with progress. */
export async function readHandoverAction(orgId: string) {
  const ctx = await club(orgId);
  if (!ctx) return DENIED;
  const h = ctx.handover;
  const { season, positions } = ctx.committee;
  if (!h || h.switchedAt) return { success: true as const, handover: null, president: ctx.president, season, last: h?.switchedAt ? h.season : null };
  const terms = Array.from(await db.execute<Term>(sql`
    SELECT id, position_id, season, user_id, holder_name, state, handover FROM club_position_terms
    WHERE org_id = ${orgId}::uuid AND season IN (${season}, ${h.season}) AND state IN ('offered', 'holding')`));
  if (!ctx.president && !terms.some((t) => t.user_id === ctx.userId)) return { success: true as const, handover: null, president: false, season, last: null };
  const outs = [...new Set(terms.filter((t) => t.season === season && t.state === "holding" && t.user_id).map((t) => t.user_id!))];
  const open = outs.length ? Array.from(await db.execute<{ id: string; tasks: number; docs: number }>(sql`
    SELECT u.id, (SELECT count(*)::int FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE t.assignee_id = u.id AND t.deleted_at IS NULL AND t.status <> 'done'
        AND (w.id = ${orgId}::uuid OR w.parent_id = ${orgId}::uuid OR w.org_settings->>'groupOf' = ${orgId}::text)) AS tasks,
      (SELECT count(*)::int FROM workspace_documents d WHERE d.workspace_id = ${orgId}::uuid AND d.settings->'org'->>'owner' = u.id::text) AS docs
    FROM unnest(${`{${outs.join(",")}}`}::uuid[]) AS u(id)`)) : [];
  const today = new Date().toISOString().slice(0, 10);
  const people = ctx.president ? Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' AND m.completed_at IS NULL ORDER BY 2 LIMIT 500`)) : [];
  return { success: true as const, president: ctx.president, me: ctx.userId, season, people, last: null,
    handover: { season: h.season, date: h.date, open: checklistOpen(h, today) },
    rows: positions.map((p) => {
      const out = terms.find((t) => t.position_id === p.id && t.season === season && t.state === "holding");
      const inc = terms.find((t) => t.position_id === p.id && t.season === h.season);
      const ticks = out?.handover ?? {};
      const work = open.find((o) => o.id === out?.user_id);
      return { id: p.id, label: p.label, president: p.gives === "president", filled: p.filled,
        outgoing: out ? { termId: out.id, userId: out.user_id, name: out.holder_name } : null,
        incoming: inc ? { termId: inc.id, userId: inc.user_id, name: inc.holder_name, state: inc.state as "offered" | "holding" } : null,
        ticks, done: HANDOVER_ITEMS.filter((i) => ticks[i.id]).length, canTick: Boolean(out) && (ctx.president || out?.user_id === ctx.userId) && !ctx.blocked,
        work: { tasks: work?.tasks ?? 0, docs: work?.docs ?? 0 } };
    }) };
}

/** The President sets the incoming Season and the handover date (setting it again starts over). */
export async function saveHandoverAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await club(orgId);
  if (!ctx?.president) return DENIED;
  const parsed = handoverSchema.pick({ season: true, date: true }).strict().safeParse(input);
  if (!parsed.success) return { success: false, error: "Name the incoming Season and pick the handover date." };
  if (parsed.data.season === ctx.committee.season) return { success: false, error: "The incoming Season needs its own name." };
  await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(coalesce(org_settings, '{}'::jsonb), '{club}', coalesce(org_settings->'club', '{}'::jsonb) || jsonb_build_object('handover', ${JSON.stringify(parsed.data)}::jsonb))
    WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** The outgoing officer this Season (or the President): their term while a handover is set and not yet switched. */
async function outgoing(orgId: string, termId: string) {
  const ctx = await club(orgId);
  if (!ctx || ctx.blocked || !isLooseUuid(termId) || !ctx.handover || ctx.handover.switchedAt) return null;
  const [t] = Array.from(await db.execute<Term>(sql`
    SELECT id, position_id, season, user_id, holder_name, state, handover FROM club_position_terms WHERE id = ${termId}::uuid AND org_id = ${orgId}::uuid
      AND season = ${ctx.committee.season} AND state = 'holding' AND (${ctx.president} OR user_id = ${ctx.userId}::uuid)`));
  return t ? { ctx, t, h: ctx.handover } : null;
}

/** Tick or untick a checklist item the officer does by hand: role page updated, accounts listed, the Handover meeting. */
export async function tickHandoverAction(orgId: string, termId: string, item: string, on: boolean): Promise<{ success: true } | Failure> {
  if (!(TICKABLE as readonly string[]).includes(item) || typeof on !== "boolean") return DENIED;
  const o = await outgoing(orgId, termId);
  if (!o) return DENIED;
  await db.execute(sql`UPDATE club_position_terms SET handover = handover || jsonb_build_object(${item}::text, ${on}) WHERE id = ${o.t.id}::uuid`);
  return { success: true };
}

/** Move the outgoing officer's open tasks and documents to the incoming officer, who has accepted. */
export async function moveWorkAction(orgId: string, termId: string): Promise<{ success: true; tasks: number; docs: number } | Failure> {
  const o = await outgoing(orgId, termId);
  if (!o?.t.user_id) return DENIED;
  const [inc] = Array.from(await db.execute<{ user_id: string | null; state: string }>(sql`
    SELECT user_id, state FROM club_position_terms WHERE org_id = ${orgId}::uuid AND position_id = ${o.t.position_id} AND season = ${o.h.season} AND state IN ('offered', 'holding')`));
  if (!inc?.user_id || inc.state !== "holding") return { success: false, error: "The incoming officer accepts the position first." };
  if (inc.user_id === o.t.user_id) return DENIED;
  const moved = await db.transaction(async (tx) => {
    const m = await moveWork(tx, orgId, o.t.user_id!, inc.user_id!);
    await tx.execute(sql`UPDATE club_position_terms SET handover = handover || '{"tasks": true, "docs": true}'::jsonb WHERE id = ${o.t.id}::uuid`);
    return m;
  });
  const label = o.ctx.committee.positions.find((p) => p.id === o.t.position_id)?.label ?? "the role";
  await notifyAll(orgId, o.ctx.w.slug ?? orgId, [{ to: inc.user_id, title: `${o.t.holder_name} handed you ${label}'s open work: ${moved.tasks} ${moved.tasks === 1 ? "task" : "tasks"}, ${moved.docs} ${moved.docs === 1 ? "document" : "documents"}` }],
    o.ctx.userId, `club-handover-moved:${o.t.id}`);
  return { success: true, ...moved };
}
