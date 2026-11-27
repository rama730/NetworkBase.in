"use server";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { syncWorkspaceChat } from "@/lib/messaging/integrations";
import { createNotification } from "@/lib/notifications/service";
import { GROUP_KINDS } from "@/lib/organizations/chapters";
import { pauseActive } from "@/lib/organizations/community";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";
import { generateWorkspaceKey } from "@/lib/workspace-key";

/**
 * Report 34.6 (plan B5.5b, M5 calls 1, 8–9): small groups. A group is a private workspace linked to its community or
 * one of its chapters (`org_settings.groupOf`, not a child workspace, so the community's organisers never inherit
 * read of it): listed to the community's members by name, kind, size, when it meets and join mode; its content stays
 * with the group. Open joins at once under the cap (12 by default), Ask sends a request the group's hosts accept,
 * Invite only takes invitations. Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

type GroupSettings = { kind: (typeof GROUP_KINDS)[number]; purpose: string; meets: string; cap: number; join: "open" | "ask" | "invite"; requests?: Array<{ userId: string; at: string }> };

/** The community (never a chapter) and whether the viewer is in it; chapters' groups are listed with their community's. */
async function community(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; chapter_of: string | null; settings: unknown }>(sql`
    SELECT org_type AS type, org_settings->>'chapterOf' AS chapter_of, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  // B7.2a (36.3 call 3): a club's committees are its groups of kind Committee, started by officers.
  if ((w?.type !== "community" && w?.type !== "club") || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  const pauseIn = (settings: unknown) => (settings as { community?: { pauses?: Record<string, { until: string }> } } | null)?.community?.pauses?.[userId] ?? null;
  let paused = pauseActive(pauseIn(w.settings), new Date());
  if (w.chapter_of) {
    // Security review: a chapter's context needs the community too — membership there, and its pause holds.
    if (!isLooseUuid(w.chapter_of)) return null;
    const c = await getWorkspaceAccessById(w.chapter_of, userId);
    if (!(c.isOwner || (c.isMember && c.memberRole !== "viewer"))) return null;
    const [cw] = Array.from(await db.execute<{ settings: unknown }>(sql`SELECT org_settings AS settings FROM workspaces WHERE id = ${w.chapter_of}::uuid`));
    paused = paused || pauseActive(pauseIn(cw?.settings), new Date());
  }
  return { userId, communityId: w.chapter_of ?? orgId, chapterId: w.chapter_of ? orgId : null, paused, club: w.type === "club", officer: a.isOwner || a.memberRole === "admin" };
}

/** Groups (call 8): the community's and its chapters' groups — name, kind, size and cap, when, chapter, join mode; never their content. */
export async function readGroupsAction(orgId: string) {
  const ctx = await community(orgId);
  if (!ctx) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; title: string; slug: string | null; settings: unknown; chapter: string | null; members: number; mine: string | null; asked: boolean }>(sql`
    SELECT g.id, g.title, g.slug, g.org_settings->'group' AS settings, ch.title AS chapter,
      (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = g.id) AS members,
      (SELECT m.role FROM workspace_members m WHERE m.workspace_id = g.id AND m.user_id = ${ctx.userId}::uuid) AS mine,
      coalesce(g.org_settings->'group'->'requests' @> jsonb_build_array(jsonb_build_object('userId', ${ctx.userId}::text)), false) AS asked
    FROM workspaces g LEFT JOIN workspaces ch ON ch.id = (g.org_settings->>'groupOf')::uuid AND ch.id <> ${ctx.communityId}::uuid
    WHERE g.kind = 'workspace' AND g.deleted_at IS NULL AND g.status <> 'archived'
      AND (g.org_settings->>'groupOf' = ${ctx.communityId} OR g.org_settings->>'groupOf' IN (SELECT c.id::text FROM workspaces c WHERE c.org_settings->>'chapterOf' = ${ctx.communityId} AND c.deleted_at IS NULL))
    ORDER BY g.title LIMIT 300`));
  const askIds = [...new Set(rows.flatMap((r) => (r.mine === "owner" || r.mine === "admin" ? (((r.settings ?? {}) as GroupSettings).requests ?? []).map((q) => q.userId) : [])))].filter(isLooseUuid);
  const names = askIds.length ? new Map(Array.from(await db.execute<{ id: string; name: string | null; username: string | null }>(sql`
    SELECT id, full_name AS name, username FROM profiles WHERE id = ANY(${`{${askIds.join(",")}}`}::uuid[])`)).map((p) => [p.id, p.name ?? p.username ?? "Someone"])) : new Map<string, string>();
  return { success: true as const, canStart: !ctx.paused && (!ctx.club || ctx.officer), club: ctx.club, groups: rows.map((r) => {
    const s = (r.settings ?? {}) as GroupSettings;
    const host = r.mine === "owner" || r.mine === "admin";
    return { id: r.id, title: r.title, slug: r.slug, kind: s.kind ?? "other", meets: s.meets ?? "", purpose: s.purpose ?? "", cap: s.cap ?? 12, join: s.join ?? "open", chapter: r.chapter,
      members: r.members, mine: Boolean(r.mine), asked: r.asked, host,
      // Ask requests: only the group's hosts see who asked.
      requests: host ? (s.requests ?? []).map((q) => q.userId) : [], requestNames: host ? (s.requests ?? []).map((q) => names.get(q.userId) ?? "Someone") : [] };
  }) };
}

const startSchema = z.object({
  title: z.string().trim().min(3).max(80), kind: z.enum(GROUP_KINDS), purpose: z.string().trim().max(500), meets: z.string().trim().max(80),
  cap: z.number().int().min(2).max(50), join: z.enum(["open", "ask", "invite"]), chapterId: z.string().uuid().nullable(),
}).strict();

/** Start a small group (any member, not while paused): a private workspace with Our commitment; the starter hosts it. */
export async function startGroupAction(orgId: string, input: unknown): Promise<{ success: true; id: string; slug: string } | Failure> {
  const ctx = await community(orgId);
  const parsed = startSchema.safeParse(input);
  if (!ctx) return DENIED;
  if (ctx.paused) return { success: false, error: "You can start a group when your pause ends." };
  if (!parsed.success) return { success: false, error: "Give the group a name, a kind and a size between 2 and 50." };
  const d = parsed.data;
  // A club's committees: officers start them, and they're of kind Committee (a community keeps its own kinds).
  if (ctx.club && (!ctx.officer || d.kind !== "committee")) return { success: false, error: "Officers start committees." };
  if (!ctx.club && d.kind === "committee") return DENIED;
  const home = d.chapterId ?? ctx.chapterId ?? ctx.communityId;
  if (d.chapterId) {
    // A chapter's group: the chapter belongs to this community and the starter is in it.
    const [ok] = Array.from(await db.execute<{ ok: boolean }>(sql`
      SELECT true AS ok FROM workspaces c JOIN workspace_members m ON m.workspace_id = c.id AND m.user_id = ${ctx.userId}::uuid AND m.role IN ('member', 'admin', 'owner')
      WHERE c.id = ${d.chapterId}::uuid AND c.org_settings->>'chapterOf' = ${ctx.communityId} AND c.deleted_at IS NULL`));
    if (!ok) return { success: false, error: "Start a chapter’s group from inside that chapter." };
  }
  // Security review: the same limit as making any workspace, and up to 5 groups hosted per person in a community.
  const { consumeRateLimit } = await import("@/lib/security/rate-limit");
  if (!(await consumeRateLimit(`create:project:user:${ctx.userId}`, 10, 60 * 60)).allowed) return { success: false, error: "You’ve started a lot just now. Try again in a while." };
  const [hosted] = Array.from(await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM workspaces g WHERE g.owner_id = ${ctx.userId}::uuid AND g.kind = 'workspace' AND g.deleted_at IS NULL AND g.status <> 'archived'
      AND (g.org_settings->>'groupOf' = ${ctx.communityId} OR g.org_settings->>'groupOf' IN (SELECT c.id::text FROM workspaces c WHERE c.org_settings->>'chapterOf' = ${ctx.communityId}))`));
  if ((hosted?.n ?? 0) >= 5) return { success: false, error: "You host 5 groups here already." };
  const slug = `${d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "group"}-${randomUUID().slice(0, 4)}`;
  const group: GroupSettings = { kind: d.kind, purpose: d.purpose, meets: d.meets, cap: d.cap, join: d.join, requests: [] };
  const id = await db.transaction(async (tx) => {
    const [made] = Array.from(await tx.execute<{ id: string }>(sql`
      INSERT INTO workspaces (owner_id, title, slug, key, current_task_number, kind, visibility, status, org_settings, description, short_description)
      VALUES (${ctx.userId}::uuid, ${d.title}, ${slug}, ${`${generateWorkspaceKey(d.title)}${randomUUID().slice(0, 3).toUpperCase()}`}, 0, 'workspace', 'private', 'active',
        ${JSON.stringify({ groupOf: home, group })}::jsonb, ${d.purpose || null}, ${d.purpose ? d.purpose.slice(0, 140) : null})
      RETURNING id`));
    await tx.execute(sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${made!.id}::uuid, ${ctx.userId}::uuid, 'owner')`);
    await syncWorkspaceChat(tx as never, made!.id, null, "ensure_default");
    return made!.id;
  });
  // Our commitment: the group's home document, drafted for the group to agree on.
  const { applyCreationIntentAction } = await import("@/app/actions/workspace/doc");
  await applyCreationIntentAction(id, { mode: "starter", publishOnCreate: true, includeRoles: false,
    starterContent: `# Our commitment\n\n${d.purpose ? `${d.purpose}\n\n` : ""}## When we meet\n\n${d.meets || "_Add when you meet._"}\n\n## What we agree\n\n- Come when you can; say when you can’t.\n- Be kind; the community’s Code of conduct applies here.\n- What’s shared in the group stays in the group.\n` }).catch(() => undefined);
  return { success: true, id, slug };
}

/** Join (Open, under the cap) or Ask (a request the hosts accept). Members of the group's community only; never Invite only. */
export async function joinGroupAction(orgId: string, groupId: string): Promise<{ success: true; outcome: "joined" | "asked" } | Failure> {
  const ctx = await community(orgId);
  if (!ctx || !isLooseUuid(groupId)) return DENIED;
  if (ctx.paused) return { success: false, error: "You can join groups when your pause ends." };
  const result = await db.transaction(async (tx) => {
    const [g] = Array.from(await tx.execute<{ settings: GroupSettings; home: string; title: string; members: number }>(sql`
      SELECT g.org_settings->'group' AS settings, g.org_settings->>'groupOf' AS home, g.title, (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = g.id) AS members
      FROM workspaces g WHERE g.id = ${groupId}::uuid AND g.kind = 'workspace' AND g.deleted_at IS NULL AND g.status <> 'archived' FOR UPDATE`));
    if (!g || !(g.home === ctx.communityId || (await tx.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspaces c WHERE c.id = ${g.home}::uuid AND c.org_settings->>'chapterOf' = ${ctx.communityId}`)).length)) return { error: DENIED.error };
    // A chapter's group takes that chapter's members.
    if (g.home !== ctx.communityId) {
      const [inChapter] = Array.from(await tx.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspace_members WHERE workspace_id = ${g.home}::uuid AND user_id = ${ctx.userId}::uuid AND role IN ('member', 'admin', 'owner')`));
      if (!inChapter) return { error: "Join the chapter first: this group is part of it." };
    }
    const [already] = Array.from(await tx.execute<{ ok: boolean }>(sql`SELECT true AS ok FROM workspace_members WHERE workspace_id = ${groupId}::uuid AND user_id = ${ctx.userId}::uuid`));
    if (already) return { outcome: "joined" as const, title: g.title };
    if (g.settings.join === "invite") return { error: "This group is invite only." };
    if (g.members >= (g.settings.cap ?? 12)) return { error: "This group is full." };
    if (g.settings.join === "ask") {
      if ((g.settings.requests ?? []).some((q) => q.userId === ctx.userId)) return { outcome: "asked" as const, title: g.title };
      const requests = [...(g.settings.requests ?? []), { userId: ctx.userId, at: new Date().toISOString() }].slice(-100);
      await tx.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{group,requests}', ${JSON.stringify(requests)}::jsonb) WHERE id = ${groupId}::uuid`);
      return { outcome: "asked" as const, title: g.title };
    }
    await tx.execute(sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${groupId}::uuid, ${ctx.userId}::uuid, 'member')`);
    return { outcome: "joined" as const, title: g.title };
  });
  if ("error" in result) return { success: false, error: result.error! };
  if (result.outcome === "asked") {
    const hosts = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${groupId}::uuid AND role IN ('owner', 'admin')`));
    for (const h of hosts) {
      await createNotification({ recipientUserId: h.id, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
        title: `Someone asked to join ${result.title}`, href: `/org/${encodeURIComponent(orgId)}?tab=projects&view=groups`,
        entityRefs: { projectId: groupId }, dedupeKey: `group-ask:${groupId}:${ctx.userId}` }).catch(() => undefined);
    }
  }
  return { success: true, outcome: result.outcome };
}

/** Accept or decline an Ask (the group's hosts): accepting adds them under the cap. */
export async function answerGroupRequestAction(orgId: string, groupId: string, person: string, accept: boolean): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  if (!ctx || !isLooseUuid(groupId) || !isLooseUuid(person) || typeof accept !== "boolean") return DENIED;
  const r = await db.transaction(async (tx) => {
    const [g] = Array.from(await tx.execute<{ settings: GroupSettings; members: number; host: boolean }>(sql`
      SELECT g.org_settings->'group' AS settings, (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = g.id) AS members,
        EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = g.id AND m.user_id = ${ctx.userId}::uuid AND m.role IN ('owner', 'admin')) AS host
      FROM workspaces g WHERE g.id = ${groupId}::uuid AND g.deleted_at IS NULL FOR UPDATE`));
    if (!g?.host || !(g.settings.requests ?? []).some((q) => q.userId === person)) return { error: DENIED.error };
    // Security review: the group belongs to this community, and the person is still in its home (and the community) and not paused.
    const [home] = Array.from(await tx.execute<{ home: string; community: string; ok: boolean; paused_home: string | null; paused_community: string | null }>(sql`
      SELECT h.id AS home, coalesce(h.org_settings->>'chapterOf', h.id::text) AS community,
        EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = h.id AND m.user_id = ${person}::uuid AND m.role IN ('member', 'admin', 'owner'))
          AND (h.org_settings->>'chapterOf' IS NULL OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = (h.org_settings->>'chapterOf')::uuid AND m.user_id = ${person}::uuid AND m.role IN ('member', 'admin', 'owner'))) AS ok,
        h.org_settings->'community'->'pauses'->${person}::text->>'until' AS paused_home,
        (SELECT c.org_settings->'community'->'pauses'->${person}::text->>'until' FROM workspaces c WHERE c.id = (h.org_settings->>'chapterOf')::uuid) AS paused_community
      FROM workspaces g JOIN workspaces h ON h.id = (g.org_settings->>'groupOf')::uuid WHERE g.id = ${groupId}::uuid`));
    if (!home || home.community !== ctx.communityId) return { error: DENIED.error };
    if (accept && !home.ok) return { error: "They’re no longer in the community, so they can’t join." };
    if (accept && (pauseActive(home.paused_home ? { until: home.paused_home } : null, new Date()) || pauseActive(home.paused_community ? { until: home.paused_community } : null, new Date()))) return { error: "They can join when their pause ends." };
    const requests = (g.settings.requests ?? []).filter((q) => q.userId !== person);
    await tx.execute(sql`UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{group,requests}', ${JSON.stringify(requests)}::jsonb) WHERE id = ${groupId}::uuid`);
    if (!accept) return { ok: true };
    if (g.members >= (g.settings.cap ?? 12)) return { error: "This group is full." };
    await tx.execute(sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${groupId}::uuid, ${person}::uuid, 'member') ON CONFLICT DO NOTHING`);
    return { ok: true };
  });
  return "error" in r ? { success: false, error: r.error! } : { success: true };
}

// ---- B5.5c (report 34.6 call 10): one Poll item for a group ----

/** The group (a workspace with groupOf) and whether the viewer is in it and hosts it. */
async function groupOf(groupId: string) {
  if (!isLooseUuid(groupId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const [g] = Array.from(await db.execute<{ title: string; role: string | null }>(sql`
    SELECT g.title, (SELECT m.role FROM workspace_members m WHERE m.workspace_id = g.id AND m.user_id = ${userId}::uuid) AS role
    FROM workspaces g WHERE g.id = ${groupId}::uuid AND g.kind = 'workspace' AND g.deleted_at IS NULL AND g.org_settings ? 'groupOf'`));
  if (!g?.role || g.role === "viewer") return g ? { userId, title: g.title, member: false, host: false } : null;
  return { userId, title: g.title, member: true, host: g.role === "owner" || g.role === "admin" };
}

/** A group's polls (members): options with counts and who ticked; your ticks; open, closed or picked. */
export async function readGroupPollsAction(groupId: string) {
  const g = await groupOf(groupId);
  if (!g) return { success: true as const, isGroup: false, polls: [] };
  if (!g.member) return DENIED;
  const polls = Array.from(await db.execute<{ id: string; question: string; kind: string; options: string[]; closes_at: string; picked: number | null; created_by: string | null; open: boolean }>(sql`
    SELECT id, question, kind, options, closes_at::text, picked, created_by, closes_at > now() AS open FROM group_polls WHERE workspace_id = ${groupId}::uuid ORDER BY created_at DESC LIMIT 10`));
  const ids = polls.map((p) => p.id);
  const votes = ids.length ? Array.from(await db.execute<{ poll_id: string; option: number; user_id: string; name: string | null; username: string | null }>(sql`
    SELECT v.poll_id, v.option, v.user_id, p.full_name AS name, p.username FROM group_poll_votes v JOIN profiles p ON p.id = v.user_id
    WHERE v.poll_id = ANY(${`{${ids.join(",")}}`}::uuid[])`)) : [];
  return { success: true as const, isGroup: true, host: g.host, polls: polls.map((p) => ({
    id: p.id, question: p.question, kind: p.kind as "times" | "options", closesAt: p.closes_at, open: p.open && p.picked === null, picked: p.picked,
    canPick: g.host || p.created_by === g.userId,
    options: p.options.map((label, i) => {
      const who = votes.filter((v) => v.poll_id === p.id && v.option === i);
      return { label, count: who.length, mine: who.some((v) => v.user_id === g.userId), who: who.map((v) => v.name ?? v.username ?? "Someone") };
    }) })) };
}

const pollSchema = z.object({ question: z.string().trim().min(1).max(200), kind: z.enum(["times", "options"]), options: z.array(z.string().trim().min(1).max(80)).min(2).max(5),
  closesAt: z.string().datetime({ offset: true }) }).strict();

/** Start a poll (group members): up to five times or options, a closing time; the group hears (Normal). */
export async function createGroupPollAction(groupId: string, input: unknown): Promise<{ success: true } | Failure> {
  const g = await groupOf(groupId);
  const parsed = pollSchema.safeParse(input);
  if (!g?.member) return DENIED;
  if (!parsed.success) return { success: false, error: "A poll has a question, 2 to 5 choices and a closing time." };
  const d = parsed.data;
  if (Date.parse(d.closesAt) <= Date.now()) return { success: false, error: "Pick a closing time that hasn’t passed." };
  if (Date.parse(d.closesAt) > Date.now() + 30 * 86_400_000) return { success: false, error: "A poll closes within 30 days." };
  // Security review: no poll spam — a few per hour per person, and up to 3 open at once in a group.
  const { consumeRateLimit } = await import("@/lib/security/rate-limit");
  if (!(await consumeRateLimit(`group-poll:${g.userId}`, 5, 60 * 60)).allowed) return { success: false, error: "You’ve started a lot just now. Try again in a while." };
  const [openPolls] = Array.from(await db.execute<{ n: number; mine: number }>(sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE created_by = ${g.userId}::uuid)::int AS mine FROM group_polls WHERE workspace_id = ${groupId}::uuid AND closes_at > now() AND picked IS NULL`));
  if ((openPolls?.mine ?? 0) >= 1) return { success: false, error: "You have an open poll here; pick or wait for it first." };
  if ((openPolls?.n ?? 0) >= 3) return { success: false, error: "A group has up to 3 open polls; pick or wait for one first." };
  await db.execute(sql`INSERT INTO group_polls (workspace_id, created_by, question, kind, options, closes_at) VALUES (${groupId}::uuid, ${g.userId}::uuid, ${d.question}, ${d.kind}, ${JSON.stringify(d.options)}::jsonb, ${d.closesAt}::timestamptz)`);
  const members = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${groupId}::uuid AND role <> 'viewer' AND user_id <> ${g.userId}::uuid`));
  for (const m of members) {
    await createNotification({ recipientUserId: m.id, actorUserId: g.userId, kind: "project_task_activity", category: "tasks", importance: "more",
      title: `New poll in ${g.title}: ${d.question}`, href: `/workspaces/${groupId}`, entityRefs: { projectId: groupId },
      dedupeKey: `group-poll:${groupId}:${d.question}:${m.id}` }).catch(() => undefined);
  }
  return { success: true };
}

/** Tick (group members, while open): ticks are per option, so a times poll works as "which can you make". */
export async function voteGroupPollAction(groupId: string, pollId: string, option: number, on: boolean): Promise<{ success: true } | Failure> {
  const g = await groupOf(groupId);
  if (!g?.member || !isLooseUuid(pollId) || !Number.isInteger(option) || option < 0 || option > 4 || typeof on !== "boolean") return DENIED;
  const [p] = Array.from(await db.execute<{ n: number }>(sql`
    SELECT jsonb_array_length(options) AS n FROM group_polls WHERE id = ${pollId}::uuid AND workspace_id = ${groupId}::uuid AND closes_at > now() AND picked IS NULL`));
  if (!p || option >= p.n) return { success: false, error: "This poll is closed." };
  if (on) await db.execute(sql`INSERT INTO group_poll_votes (poll_id, user_id, option) VALUES (${pollId}::uuid, ${g.userId}::uuid, ${option}) ON CONFLICT DO NOTHING`);
  else await db.execute(sql`DELETE FROM group_poll_votes WHERE poll_id = ${pollId}::uuid AND user_id = ${g.userId}::uuid AND option = ${option}`);
  return { success: true };
}

/** Pick (the poll's starter or the group's hosts): confirms one choice and closes it; the group hears (Normal). */
export async function pickGroupPollAction(groupId: string, pollId: string, option: number): Promise<{ success: true } | Failure> {
  const g = await groupOf(groupId);
  if (!g?.member || !isLooseUuid(pollId) || !Number.isInteger(option) || option < 0 || option > 4) return DENIED;
  const [p] = Array.from(await db.execute<{ question: string; label: string }>(sql`
    UPDATE group_polls SET picked = ${option}, picked_by = ${g.userId}::uuid, closes_at = least(closes_at, now())
    WHERE id = ${pollId}::uuid AND workspace_id = ${groupId}::uuid AND picked IS NULL AND jsonb_array_length(options) > ${option}
      AND (${g.host} OR created_by = ${g.userId}::uuid)
    RETURNING question, options->>${option} AS label`));
  if (!p) return DENIED;
  const members = Array.from(await db.execute<{ id: string }>(sql`SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${groupId}::uuid AND role <> 'viewer' AND user_id <> ${g.userId}::uuid`));
  for (const m of members) {
    await createNotification({ recipientUserId: m.id, actorUserId: g.userId, kind: "project_task_activity", category: "tasks", importance: "more",
      title: `${g.title}: ${p.question} — ${p.label}`, href: `/workspaces/${groupId}`, entityRefs: { projectId: groupId },
      dedupeKey: `group-poll-pick:${pollId}:${m.id}` }).catch(() => undefined);
  }
  return { success: true };
}
