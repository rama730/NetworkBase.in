import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { amendmentLine, applyAmendment, checklistOpen, handoverDue, readClubMeetings, readHandover, readPositions, readRenewal, windowClosed, type Amendment, type Article, type ClubPosition } from "@/lib/organizations/club";

// Report 36.2 (plan B7.1b): Season renewal notices. Server only.

/** One notice to each member who should answer (Normal); `key` keeps it once per Season (ask, and the day-25 reminder). */
export async function askMembers(orgId: string, slug: string, season: string, ask: string, actor: string | null, key: "ask" | "remind") {
  const members = Array.from(await db.execute<{ id: string }>(sql`
    SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND completed_at IS NULL AND role <> 'viewer'
      AND joined_at < ${season}::date - 30 ${key === "remind" ? sql`AND coalesce(view_prefs->'club'->'renewal'->>'season', '') <> ${season}` : sql``} LIMIT 2000`));
  for (const m of members) {
    if (m.id === actor) continue;
    await createNotification({ recipientUserId: m.id, actorUserId: actor, kind: "project_task_activity", category: "tasks", importance: "more",
      title: key === "ask" ? ask : `${ask} Answer by the end of the window.`, href: `/org/${encodeURIComponent(slug)}`, entityRefs: { projectId: orgId, projectSlug: slug },
      dedupeKey: `club-renewal:${key}:${orgId}:${season}:${m.id}` }).catch(() => undefined);
  }
}


const DAY = 86_400_000;
/** Hourly (layer 15): once more at day 25 of the window, to members who haven't answered. */
export async function renewalReminders(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const clubs = Array.from(await db.execute<{ id: string; slug: string | null; settings: unknown }>(sql`
    SELECT id, slug, org_settings AS settings FROM workspaces WHERE kind = 'organization' AND org_type = 'club' AND deleted_at IS NULL AND suspended_at IS NULL AND status <> 'archived'
      AND coalesce((org_settings->'club'->'renewal'->>'on')::boolean, false) LIMIT 500`));
  let sent = 0;
  for (const c of clubs) {
    const r = readRenewal(c.settings);
    if (!r?.on || windowClosed(r, today)) continue;
    if (Date.parse(`${today}T00:00:00Z`) < Date.parse(`${r.season}T00:00:00Z`) + 25 * DAY) continue;
    await askMembers(c.id, c.slug ?? c.id, r.season, r.ask, null, "remind");
    sent++;
  }
  return { sent };
}

type Exec = Pick<typeof db, "execute">;

/**
 * B7.2c (36.3 call 10): move an outgoing officer's open work to the incoming one: open tasks in the club (and in its
 * groups the incoming officer belongs to) and the documents they own. Returns what moved.
 */
export async function moveWork(tx: Exec, orgId: string, from: string, to: string) {
  // Security review: only to someone still in the club (not a Viewer, not finished).
  const [member] = Array.from(await tx.execute(sql`SELECT 1 FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${to}::uuid AND role <> 'viewer' AND completed_at IS NULL`));
  if (!member) return { tasks: 0, docs: 0 };
  const tasks = Array.from(await tx.execute(sql`
    UPDATE tasks t SET assignee_id = ${to}::uuid, updated_at = now() FROM workspaces w
    WHERE w.id = t.workspace_id AND t.assignee_id = ${from}::uuid AND t.deleted_at IS NULL AND t.status <> 'done'
      AND (w.id = ${orgId}::uuid OR (w.parent_id = ${orgId}::uuid AND EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${to}::uuid AND m.completed_at IS NULL)))
    RETURNING t.id`)).length;
  const docs = Array.from(await tx.execute(sql`
    UPDATE workspace_documents SET settings = jsonb_set(settings, '{org,owner}', to_jsonb(${to}::text))
    WHERE workspace_id = ${orgId}::uuid AND settings->'org'->>'owner' = ${from}::text
      -- Security review: the role's documents, not private drafts or leaders-only pages (ownership would open them).
      AND coalesce(settings->'org'->>'lifecycle', 'published') <> 'draft' AND coalesce(settings->>'visibilityOverride', '') <> 'leaders_only' RETURNING id`)).length;
  return { tasks, docs };
}

/**
 * B7.2c: the Season changes (the handover date, or the President renaming the Season). Last Season's terms end and the
 * Coordinator roles they gave go with them; the new Season's holders get the role their position gives; work an outgoing
 * officer didn't move moves to their successor anyway (edge 12). The presidency never moves here (ownership transfer).
 * Returns who to tell.
 */
export async function switchSeason(tx: Exec, orgId: string, owner: string, to: string, positions: ClubPosition[]) {
  const terms = Array.from(await tx.execute<{ id: string; position_id: string; season: string; user_id: string | null; handover: Record<string, boolean> }>(sql`
    SELECT id, position_id, season, user_id, handover FROM club_position_terms WHERE org_id = ${orgId}::uuid AND state = 'holding' FOR UPDATE`));
  const tell: Array<{ to: string; title: string }> = [];
  for (const p of positions) {
    const out = terms.find((t) => t.position_id === p.id && t.season !== to && t.user_id);
    const inc = terms.find((t) => t.position_id === p.id && t.season === to && t.user_id);
    if (!out || !inc || out.user_id === inc.user_id) continue;
    if (!(out.handover.tasks && out.handover.docs)) await moveWork(tx, orgId, out.user_id!, inc.user_id!);
    tell.push({ to: out.user_id!, title: `Your term as ${p.label} has ended` }, { to: inc.user_id!, title: `You're now ${p.label}` });
  }
  const ended = Array.from(await tx.execute<{ user_id: string | null; gave_role: boolean }>(sql`
    UPDATE club_position_terms SET state = CASE WHEN state = 'holding' THEN 'ended' ELSE 'declined' END, ended_at = now()
    WHERE org_id = ${orgId}::uuid AND season <> ${to} AND state IN ('offered', 'holding') RETURNING user_id, gave_role`));
  const giving = positions.filter((p) => p.gives === "coordinator").map((p) => p.id);
  // Someone whose old term made them a Coordinator and who holds a Coordinator position again keeps that on the new term.
  const carry = [...new Set(ended.filter((e) => e.gave_role && e.user_id).map((e) => e.user_id!))];
  if (carry.length) await tx.execute(sql`UPDATE club_position_terms SET gave_role = true WHERE org_id = ${orgId}::uuid AND season = ${to} AND state = 'holding'
    AND user_id = ANY(${`{${carry.join(",")}}`}::uuid[]) AND position_id = ANY(${`{${giving.join(",") || "none"}}`}::text[])`);
  for (const u of new Set(ended.filter((e) => e.gave_role && e.user_id && e.user_id !== owner).map((e) => e.user_id!))) {
    await tx.execute(sql`UPDATE workspace_members SET role = 'member' WHERE workspace_id = ${orgId}::uuid AND user_id = ${u}::uuid AND role = 'admin'
      AND NOT EXISTS (SELECT 1 FROM club_position_terms t WHERE t.org_id = ${orgId}::uuid AND t.user_id = ${u}::uuid AND t.state = 'holding' AND t.season = ${to}
        AND t.position_id = ANY(${`{${giving.join(",") || "none"}}`}::text[]))`);
  }
  await giveRoles(tx, orgId, terms.filter((t) => t.season === to).map((t) => t.id), giving);
  return tell;
}

/**
 * These terms' holders of Coordinator positions become Coordinators; each term remembers whether it did. Security
 * review: by term id, so nobody the President took the role from by hand gets it back from someone else's change.
 */
export async function giveRoles(tx: Exec, orgId: string, termIds: string[], giving: string[]) {
  if (!termIds.length) return;
  await tx.execute(sql`
    WITH promoted AS (
      UPDATE workspace_members m SET role = 'admin' FROM club_position_terms t
      WHERE t.id = ANY(${`{${termIds.join(",")}}`}::uuid[]) AND t.org_id = ${orgId}::uuid AND t.state = 'holding' AND t.position_id = ANY(${`{${giving.join(",") || "none"}}`}::text[])
        AND m.workspace_id = t.org_id AND m.user_id = t.user_id AND m.role = 'member' AND m.completed_at IS NULL
      RETURNING m.user_id)
    UPDATE club_position_terms t SET gave_role = true FROM promoted
    WHERE t.id = ANY(${`{${termIds.join(",")}}`}::uuid[]) AND t.user_id = promoted.user_id AND t.position_id = ANY(${`{${giving.join(",") || "none"}}`}::text[])`);
}

export async function notifyAll(orgId: string, slug: string, list: Array<{ to: string; title: string }>, actor: string | null, key: string) {
  for (const n of list) {
    if (n.to === actor) continue;
    await createNotification({ recipientUserId: n.to, actorUserId: actor, kind: "project_task_activity", category: "tasks", importance: "more", title: n.title,
      href: `/org/${encodeURIComponent(slug)}`, entityRefs: { projectId: orgId, projectSlug: slug }, dedupeKey: `${key}:${n.to}:${n.title}` }).catch(() => undefined);
  }
}

/**
 * Hourly (layer 15): three weeks before the handover date, outgoing and incoming officers are told the checklist is open
 * (once); on the date the Season switches.
 */
export async function handoverSteps(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const clubs = Array.from(await db.execute<{ id: string; slug: string | null; title: string; owner: string; settings: unknown }>(sql`
    SELECT id, slug, title, owner_id AS owner, org_settings AS settings FROM workspaces WHERE kind = 'organization' AND org_type = 'club' AND deleted_at IS NULL
      AND suspended_at IS NULL AND status <> 'archived' AND org_settings->'club'->'handover' IS NOT NULL AND NOT (org_settings->'club'->'handover' ? 'switchedAt') LIMIT 500`));
  let switched = 0;
  for (const c of clubs) {
    const h = readHandover(c.settings);
    if (!h || h.switchedAt) continue;
    const slug = c.slug ?? c.id;
    if (handoverDue(h, today)) {
      const committee = readPositions(c.settings, now);
      const tell = await db.transaction(async (tx) => {
        const [locked] = Array.from(await tx.execute<{ done: boolean }>(sql`SELECT (org_settings->'club'->'handover' ? 'switchedAt') AS done FROM workspaces WHERE id = ${c.id}::uuid FOR UPDATE`));
        if (locked?.done) return null;
        const list = await switchSeason(tx, c.id, c.owner, h.season, committee.positions);
        await tx.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(jsonb_set(org_settings, '{club,committee}', ${JSON.stringify({ ...committee, season: h.season })}::jsonb),
          '{club,handover,switchedAt}', to_jsonb(${now.toISOString()}::text)) WHERE id = ${c.id}::uuid`);
        return list;
      });
      if (tell) { await notifyAll(c.id, slug, tell, null, `club-handover-switched:${c.id}:${h.season}`); switched++; }
    } else if (!h.noticedAt && checklistOpen(h, today)) {
      const people = Array.from(await db.execute<{ id: string }>(sql`
        SELECT DISTINCT user_id AS id FROM club_position_terms WHERE org_id = ${c.id}::uuid AND user_id IS NOT NULL AND state IN ('offered', 'holding') LIMIT 200`));
      await db.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{club,handover,noticedAt}', to_jsonb(${now.toISOString()}::text)) WHERE id = ${c.id}::uuid`);
      await notifyAll(c.id, slug, people.map((p) => ({ to: p.id, title: `${c.title}'s handover checklist is open; roles switch on ${h.date}` })), null, `club-handover-open:${c.id}:${h.season}`);
    }
  }
  return { switched };
}

/**
 * B7.3a (report 36.4 calls 1, 3, 5): the club a meeting belongs to — the club itself, or one of its groups (a committee's
 * meetings live in the committee). Null for anything else.
 */
export async function meetingClub(projectId: string) {
  const [w] = Array.from(await db.execute<{ id: string }>(sql`
    SELECT c.id FROM workspaces w JOIN workspaces c ON c.id = coalesce(CASE WHEN w.kind = 'organization' THEN w.id END, w.parent_id)
    WHERE w.id = ${projectId}::uuid AND c.kind = 'organization' AND c.org_type = 'club' AND c.deleted_at IS NULL`));
  return w?.id ?? null;
}

/**
 * Call 5: quorum is a share (a quarter by default) of the members staying this Season: with renewal on, those who said
 * Staying and those who joined too recently to be asked; otherwise every member who isn't a Viewer.
 */
export async function clubQuorum(clubId: string) {
  const { clubQuorumNeeded } = await import("@/lib/workflows/meetings");
  const [w] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${clubId}::uuid`));
  const share = readClubMeetings(w?.settings).quorumShare;
  const [n] = Array.from(await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM workspace_members WHERE workspace_id = ${clubId}::uuid AND ${staying(w?.settings)}`));
  return { staying: n?.n ?? 0, needed: clubQuorumNeeded(n?.n ?? 0, share) };
}

/** Members staying this Season (a workspace_members row): not Viewers, not finished, and with renewal on, Staying or too new to ask. */
export function staying(settings: unknown) {
  const r = readRenewal(settings);
  return sql`role <> 'viewer' AND completed_at IS NULL
    ${r?.on ? sql`AND (joined_at >= ${r.season}::date - 30 OR (view_prefs->'club'->'renewal'->>'season' = ${r.season} AND view_prefs->'club'->'renewal'->>'answer' = 'staying'))` : sql``}`;
}

/**
 * B7.3c (call 4): close online motion votes whose time has come (all, or one club's). Abstentions count for turnout only;
 * below the quorum fixed when it opened the motion is Not quorate; an amendment needs its threshold of those voting For
 * or Against, and a passed one publishes the next constitution. Members are told the result (Normal). Hourly, and on read.
 */
export async function closeMotionVotes(now = new Date(), clubId?: string) {
  const due = Array.from(await db.execute<{ id: string }>(sql`
    SELECT id FROM club_motion_votes WHERE state = 'open' AND closes_at <= ${now.toISOString()}::timestamptz ${clubId ? sql`AND org_id = ${clubId}::uuid` : sql``} LIMIT 200`));
  let closed = 0;
  for (const { id } of due) {
    const done = await db.transaction(async (tx) => {
      const [v] = Array.from(await tx.execute<{ org_id: string; doc_id: string; motion_id: string; text: string; amendment: Amendment | null; threshold: string; needed: number; created_by: string | null }>(sql`
        SELECT org_id, doc_id, motion_id, text, amendment, threshold::text, needed, created_by FROM club_motion_votes WHERE id = ${id}::uuid AND state = 'open' FOR UPDATE`));
      if (!v) return null;
      const counts = { for: 0, against: 0, abstain: 0 };
      for (const b of Array.from(await tx.execute<{ choice: "for" | "against" | "abstain"; n: number }>(sql`SELECT choice, count(*)::int AS n FROM club_motion_ballots WHERE vote_id = ${id}::uuid GROUP BY choice`))) counts[b.choice] = b.n;
      const { amendmentPasses } = await import("@/lib/organizations/club");
      const turnout = counts.for + counts.against + counts.abstain;
      const result = turnout < v.needed ? "not_quorate" : (v.amendment ? amendmentPasses(counts, Number(v.threshold)) : counts.for > counts.against) ? "passed" : "failed";
      await tx.execute(sql`UPDATE club_motion_votes SET state = 'closed', closed_at = now(), result = ${JSON.stringify({ ...counts, result })}::jsonb WHERE id = ${id}::uuid`);
      return { v, result };
    });
    if (!done) continue;
    closed++;
    if (done.result === "passed" && done.v.amendment) await publishAmendment(done.v.org_id, done.v.doc_id, done.v.motion_id, done.v.amendment, done.v.created_by);
    const [w] = Array.from(await db.execute<{ slug: string | null; title: string; settings: unknown }>(sql`SELECT slug, title, org_settings AS settings FROM workspaces WHERE id = ${done.v.org_id}::uuid`));
    const members = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${done.v.org_id}::uuid AND ${staying(w?.settings)} LIMIT 2000`));
    const word = done.result === "passed" ? "passed" : done.result === "failed" ? "failed" : "was not quorate";
    await notifyAll(done.v.org_id, w?.slug ?? done.v.org_id, members.map((m) => ({ to: m.id, title: `Online vote ${word}: ${done.v.text}` })), null, `club-motion-vote-result:${id}`);
  }
  // One reminder, a day before it closes, to members who haven't voted.
  const soon = Array.from(await db.execute<{ id: string; org_id: string; text: string }>(sql`
    UPDATE club_motion_votes SET reminded_at = now() WHERE state = 'open' AND reminded_at IS NULL AND closes_at <= ${now.toISOString()}::timestamptz + interval '1 day'
      ${clubId ? sql`AND org_id = ${clubId}::uuid` : sql``} RETURNING id, org_id, text`));
  for (const v of soon) {
    const [w] = Array.from(await db.execute<{ slug: string | null; settings: unknown }>(sql`SELECT slug, org_settings AS settings FROM workspaces WHERE id = ${v.org_id}::uuid`));
    const left = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${v.org_id}::uuid AND ${staying(w?.settings)}
      AND NOT EXISTS (SELECT 1 FROM club_motion_voted x WHERE x.vote_id = ${v.id}::uuid AND x.user_id = workspace_members.user_id) LIMIT 2000`));
    await notifyAll(v.org_id, w?.slug ?? v.org_id, left.map((m) => ({ to: m.id, title: `Online vote closes in a day: ${v.text}` })), null, `club-motion-vote-remind:${v.id}`);
  }
  return { closed };
}

/** B7.3b (call 7): the club's current constitution (latest version), or null before the first. */
export async function currentConstitution(clubId: string, exec: Exec = db) {
  const [v] = Array.from(await exec.execute<{ version: number; articles: Article[] }>(sql`
    SELECT version, articles FROM club_constitution_versions WHERE org_id = ${clubId}::uuid ORDER BY version DESC LIMIT 1`));
  return v ?? null;
}

/**
 * A passed amendment motion publishes the next version (under the club row's lock, so two never take one number),
 * linked to its meeting and motion; members are told (Normal). Returns the new version, or null when it no longer fits.
 */
export async function publishAmendment(clubId: string, docId: string, motionId: string, a: Amendment, actor: string | null) {
  const out = await db.transaction(async (tx) => {
    const [w] = Array.from(await tx.execute<{ settings: unknown; slug: string | null; title: string }>(sql`SELECT org_settings AS settings, slug, title FROM workspaces WHERE id = ${clubId}::uuid FOR UPDATE`));
    const cur = await currentConstitution(clubId, tx);
    if (!w || !cur) return null;
    const next = applyAmendment(cur.articles, a);
    if (!next) return null;
    await tx.execute(sql`INSERT INTO club_constitution_versions (org_id, version, articles, changed, season, doc_id, motion_id, created_by)
      VALUES (${clubId}::uuid, ${cur.version + 1}, ${JSON.stringify(next)}::jsonb, ${amendmentLine(cur.articles, a)}, ${readPositions(w.settings).season}, ${docId}::uuid, ${motionId}, ${actor}::uuid)`);
    return { version: cur.version + 1, slug: w.slug ?? clubId, title: w.title, line: amendmentLine(cur.articles, a) };
  });
  if (!out) return null;
  const members = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${clubId}::uuid AND role <> 'viewer' AND completed_at IS NULL LIMIT 2000`));
  await notifyAll(clubId, out.slug, members.map((m) => ({ to: m.id, title: `${out.title}'s constitution changed: ${out.line} (version ${out.version})` })), actor, `club-constitution:${clubId}:${out.version}`);
  return out.version;
}
