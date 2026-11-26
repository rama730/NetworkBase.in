"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { logCommunityAction, type CommunityLogEntry } from "@/lib/organizations/community-server";
import { COMMUNITY_LABELS, isNewMember, memberStatus, readMembersSettings, type CommunityLabel } from "@/lib/organizations/community";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 34.3 (plan B5.2, M2): a community's Members is the Directory for every member (call 1); members show by
 * default and can hide, and hide their counts (calls 2–3). Organisers see People with New · Active · Quiet (call 4,
 * never shown to members), give the Moderator grant and the Host and Helper labels (calls 5–6), and set Members
 * settings. Viewers and visitors never read the directory. Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function community(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; slug: string | null; title: string; settings: unknown }>(sql`
    SELECT org_type AS type, slug, title, org_settings AS settings FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  if (w?.type !== "community" || !(a.isOwner || a.isMember) || (!a.isOwner && a.memberRole === "viewer")) return null;
  return { userId, slug: w.slug ?? orgId, title: w.title, organiser: a.isOwner || a.memberRole === "admin", members: readMembersSettings(w.settings) };
}

type Prefs = { hidden?: boolean; hideCounts?: boolean; labels?: CommunityLabel[]; answers?: Record<string, string>; showAnswer?: boolean };
type Row = { id: string; name: string | null; username: string | null; avatar_url: string | null; role: string; owner: boolean; joined: string | null;
  location: string | null; interests: unknown; skills: unknown; prefs: Prefs | null; posts: number; last_active: string | null };

/** `viewer`: the Directory leaves out anyone the viewer is in a block with (either way); organisers' People keeps everyone. */
async function rows(orgId: string, viewer?: string) {
  return Array.from(await db.execute<Row>(sql`
    SELECT p.id, p.full_name AS name, p.username, p.avatar_url, m.role, (w.owner_id = m.user_id) AS owner, m.joined_at::text AS joined,
      p.location, p.interests, p.skills, m.view_prefs->'community' AS prefs,
      (SELECT count(*)::int FROM workspace_updates u WHERE u.workspace_id = w.id AND u.author_id = m.user_id AND u.deleted_at IS NULL) AS posts,
      greatest(
        (SELECT max(u.created_at) FROM workspace_updates u WHERE u.workspace_id = w.id AND u.author_id = m.user_id AND u.deleted_at IS NULL),
        (SELECT max(c.created_at) FROM workspace_update_comments c WHERE c.workspace_id = w.id AND c.user_id = m.user_id AND c.deleted_at IS NULL))::text AS last_active
    FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer'
      AND (${viewer ?? null}::uuid IS NULL OR m.user_id = ${viewer ?? null}::uuid OR NOT app_private.blocked_between(${viewer ?? null}::uuid, m.user_id))
    ORDER BY coalesce(p.full_name, p.username) LIMIT 2000`));
}

const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 6) : []);
const labelsOf = (r: Row) => (r.prefs?.labels ?? []).filter((l) => COMMUNITY_LABELS.includes(l));
const roleOf = (r: Row) => (r.owner || r.role === "owner" || r.role === "admin" ? "organiser" as const : null);
/** Here for (M1): the member's first join answer, only when they chose to show it on their card. */
const hereFor = (p: Prefs | null) => (p?.showAnswer ? Object.values(p.answers ?? {}).find((a) => a.trim())?.slice(0, 120) ?? null : null);

export type CommunityCard = {
  id: string; name: string; username: string | null; avatarUrl: string | null; place: string | null; interests: string[]; askMeAbout: string[];
  hereFor: string | null; joined: string | null; isNew: boolean; organiser: boolean; labels: CommunityLabel[]; posts: number | null;
};

/** The Directory (calls 1–3): every member, own card first; hidden members stay out (they still show on their posts). */
export async function readCommunityDirectoryAction(orgId: string) {
  const ctx = await community(orgId);
  if (!ctx) return DENIED;
  const now = new Date();
  const all = await rows(orgId, ctx.userId);
  const card = (r: Row): CommunityCard => ({
    id: r.id, name: r.name ?? r.username ?? "Someone", username: r.username, avatarUrl: r.avatar_url, place: r.location?.trim() || null,
    interests: list(r.interests), askMeAbout: list(r.skills), hereFor: hereFor(r.prefs), joined: r.joined, isNew: isNewMember(r.joined, now),
    organiser: roleOf(r) === "organiser", labels: labelsOf(r), posts: r.prefs?.hideCounts ? null : r.posts,
  });
  const me = all.find((r) => r.id === ctx.userId);
  const people = all.filter((r) => r.id !== ctx.userId && !r.prefs?.hidden).map(card);
  return { success: true as const, organiser: ctx.organiser, moderator: Boolean(me && labelsOf(me).includes("moderator")), helperWord: ctx.members.helperWord,
    me: me ? { ...card(me), hidden: me.prefs?.hidden === true, hideCounts: me.prefs?.hideCounts === true } : null, people };
}

const cardSchema = z.object({ hidden: z.boolean(), hideCounts: z.boolean() }).strict();

/** Show me in the directory and Show my counts (calls 2–3): the member's own switches, on their membership. */
export async function saveMyCommunityCardAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  const parsed = cardSchema.safeParse(input);
  if (!ctx || !parsed.success) return DENIED;
  await db.execute(sql`UPDATE workspace_members SET view_prefs = coalesce(view_prefs, '{}'::jsonb) || jsonb_build_object('community', coalesce(view_prefs->'community', '{}'::jsonb) || ${JSON.stringify(parsed.data)}::jsonb)
    WHERE workspace_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid`);
  return { success: true };
}

export type CommunityPerson = CommunityCard & { status: "new" | "active" | "quiet"; hidden: boolean; answers: Record<string, string>; lastActive: string | null; postsAll: number };

/** People and Roles (organisers only, call 4): everyone with status, roles, joined and join answers; hidden members too. */
export async function readCommunityPeopleAction(orgId: string) {
  const ctx = await community(orgId);
  if (!ctx?.organiser) return DENIED;
  const now = new Date();
  const people: CommunityPerson[] = (await rows(orgId)).map((r) => ({
    id: r.id, name: r.name ?? r.username ?? "Someone", username: r.username, avatarUrl: r.avatar_url, place: r.location?.trim() || null,
    interests: list(r.interests), askMeAbout: list(r.skills), hereFor: hereFor(r.prefs), joined: r.joined, isNew: isNewMember(r.joined, now),
    organiser: roleOf(r) === "organiser", labels: labelsOf(r), posts: r.posts, postsAll: r.posts,
    status: memberStatus(r.joined, r.last_active, now, ctx.members.quietDays), hidden: r.prefs?.hidden === true,
    answers: r.prefs?.answers ?? {}, lastActive: r.last_active,
  }));
  const counts = { new: 0, active: 0, quiet: 0 };
  for (const p of people) counts[p.status] += 1;
  return { success: true as const, people, counts, settings: ctx.members };
}

const LABEL_WORD: Record<CommunityLabel, string> = { moderator: "Moderator", host: "Host", helper: "Helper" };

/** Give or take a role (calls 5–6, organisers): Moderator, Host or Helper; the person is told (Normal); the log keeps it. */
export async function setCommunityLabelAction(orgId: string, person: string, label: string, on: boolean): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  if (!ctx?.organiser || !isLooseUuid(person) || !COMMUNITY_LABELS.includes(label as CommunityLabel)) return DENIED;
  const l = label as CommunityLabel;
  const [r] = Array.from(await db.execute<{ labels: unknown }>(sql`
    UPDATE workspace_members SET view_prefs = coalesce(view_prefs, '{}'::jsonb) || jsonb_build_object('community', coalesce(view_prefs->'community', '{}'::jsonb)
      || jsonb_build_object('labels', coalesce((SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(coalesce(view_prefs->'community'->'labels', '[]'::jsonb) || ${JSON.stringify(on ? [l] : [])}::jsonb) x WHERE x <> ${on ? "" : l}), '[]'::jsonb)))
    WHERE workspace_id = ${orgId}::uuid AND user_id = ${person}::uuid AND role IN ('member', 'admin', 'owner')
    RETURNING view_prefs->'community'->'labels' AS labels`));
  if (!r) return { success: false, error: "That person isn’t a member here." };
  await logCommunityAction(orgId, { by: ctx.userId, action: on ? "role_given" : "role_removed", person, label: l });
  if (on && person !== ctx.userId) {
    const word = l === "helper" ? ctx.members.helperWord : LABEL_WORD[l];
    await createNotification({ recipientUserId: person, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: "more",
      title: `You’re now a ${word} in ${ctx.title}`, href: `/org/${encodeURIComponent(ctx.slug)}?tab=members`, entityRefs: { projectId: orgId, projectSlug: ctx.slug },
      dedupeKey: `community-label:${orgId}:${person}:${l}:${new Date().toISOString().slice(0, 10)}` }).catch(() => undefined);
  }
  return { success: true };
}

const membersSchema = z.object({ quietDays: z.number().int().min(14).max(365), helperWord: z.string().trim().min(1).max(30), pauseHours: z.array(z.union([z.literal(24), z.literal(168)])).min(1).max(2) }).strict();

/** Settings → Members (organisers): Quiet after, the Helper label's wording, how long Pause posting can last. */
export async function saveCommunityMembersSettingsAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await community(orgId);
  if (!ctx?.organiser) return DENIED;
  const parsed = membersSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Quiet after is 14 to 365 days, and the label needs a name." };
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('community', coalesce(org_settings->'community', '{}'::jsonb)
    || jsonb_build_object('members', ${JSON.stringify(parsed.data)}::jsonb)), updated_at = now() WHERE id = ${orgId}::uuid`);
  return { success: true };
}

/** Activity log (organisers): names for the people involved. */
export async function readCommunityLogAction(orgId: string) {
  const ctx = await community(orgId);
  if (!ctx?.organiser) return DENIED;
  const [w] = Array.from(await db.execute<{ log: CommunityLogEntry[] | null }>(sql`SELECT org_settings->'community'->'log' AS log FROM workspaces WHERE id = ${orgId}::uuid`));
  const log = Array.isArray(w?.log) ? w.log : [];
  const ids = [...new Set(log.flatMap((e) => [e.by, e.person].filter((x): x is string => Boolean(x && isLooseUuid(x)))))];
  const names = ids.length ? new Map(Array.from(await db.execute<{ id: string; name: string | null; username: string | null }>(sql`
    SELECT id, full_name AS name, username FROM profiles WHERE id = ANY(${`{${ids.join(",")}}`}::uuid[])`)).map((p) => [p.id, p.name ?? p.username ?? "Someone"])) : new Map<string, string>();
  return { success: true as const, helperWord: ctx.members.helperWord, entries: log.map((e) => ({ ...e, byName: names.get(e.by) ?? "Someone", personName: e.person ? names.get(e.person) ?? "Former member" : null })) };
}
