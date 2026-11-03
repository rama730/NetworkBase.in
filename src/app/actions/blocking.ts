'use server'

import { and, eq, isNull, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { z } from 'zod'

import { db } from '@/lib/db'
import { profiles, userBlocks, userMutes } from '@/lib/db/schema'
import { notifyOrg, orgHref } from '@/lib/organizations/notify'
import { BLOCK_UNDO_SECONDS, setUserBlocked, undoUserBlock, type BlockSource } from '@/lib/privacy/blocks'
import { consumeRateLimit } from '@/lib/security/rate-limit'
import { getViewerAuthContext } from '@/lib/server/viewer-context'

// Blocking from anywhere you meet a person (Trust & Safety report, Blocking B5, B12, B25, B30). The database does the
// work (block_user, undo_block); these check who's asking and how often.

type Result<T = object> = ({ success: true } & T) | { success: false; error: string }
const uuid = z.string().uuid()
const SOURCES = ['profile', 'message', 'comment', 'person_card', 'member_list', 'settings'] as const satisfies readonly BlockSource[]

async function me() {
    const { userId } = await getViewerAuthContext()
    return userId ?? null
}

async function requestFor(path: string) {
    return new Request(`https://networkbase.in${path}`, { headers: new Headers(await headers()) })
}

async function limited(userId: string) {
    const rate = await consumeRateLimit(`privacy:block:${userId}`, 60, 60)
    return !rate.allowed
}

/** What the confirmation says about the two of you (B5): shared spaces, and whether you're connected. */
export async function readBlockImpactAction(targetId: string): Promise<Result<{ sharedSpaces: string[]; sharedCount: number; connected: boolean }>> {
    const userId = await me()
    if (!userId || !uuid.safeParse(targetId).success || targetId === userId) return { success: false, error: 'Couldn’t load this.' }
    const rows = await db.execute(sql`
        SELECT w.title FROM workspace_members a
        JOIN workspace_members b ON b.workspace_id = a.workspace_id AND b.user_id = ${targetId}
        JOIN workspaces w ON w.id = a.workspace_id AND w.deleted_at IS NULL
        WHERE a.user_id = ${userId} ORDER BY w.title LIMIT 50`) as unknown as Array<{ title: string }>
    const [connected] = await db.execute(sql`
        SELECT EXISTS (SELECT 1 FROM connections c WHERE c.status = 'accepted'
          AND ((c.requester_id = ${userId} AND c.addressee_id = ${targetId}) OR (c.requester_id = ${targetId} AND c.addressee_id = ${userId}))) AS value`) as unknown as Array<{ value: boolean }>
    return { success: true, sharedSpaces: rows.slice(0, 2).map((r) => r.title), sharedCount: rows.length, connected: Boolean(connected?.value) }
}

export async function blockPersonAction(targetId: string, source: (typeof SOURCES)[number] = 'profile'): Promise<Result<{ undoSeconds: number }>> {
    const userId = await me()
    if (!userId) return { success: false, error: 'Sign in to continue.' }
    if (!uuid.safeParse(targetId).success || targetId === userId || !SOURCES.includes(source)) return { success: false, error: 'Couldn’t block this account.' }
    if (await limited(userId)) return { success: false, error: 'You’re going a bit fast. Try again in a moment.' }
    const target = await setUserBlocked({ blockerId: userId, targetUserId: targetId, blocked: true, request: await requestFor('/block'), source })
    return target ? { success: true, undoSeconds: BLOCK_UNDO_SECONDS } : { success: false, error: 'This account isn’t available.' }
}

/** Undo within 10 seconds puts back everything the block removed (B12, B39). */
export async function undoBlockAction(targetId: string): Promise<Result> {
    const userId = await me()
    if (!userId || !uuid.safeParse(targetId).success) return { success: false, error: 'Couldn’t undo.' }
    return (await undoUserBlock(userId, targetId)) ? { success: true } : { success: false, error: 'Undo is only possible for 10 seconds. Unblock instead.' }
}

export async function unblockPersonAction(targetId: string): Promise<Result> {
    const userId = await me()
    if (!userId || !uuid.safeParse(targetId).success) return { success: false, error: 'Couldn’t unblock.' }
    if (await limited(userId)) return { success: false, error: 'You’re going a bit fast. Try again in a moment.' }
    await setUserBlocked({ blockerId: userId, targetUserId: targetId, blocked: false, request: await requestFor('/unblock') })
    return { success: true }
}

/** Block someone by @handle from Settings (B25), without opening their profile. */
export async function blockByHandleAction(handle: string): Promise<Result<{ id: string; name: string; undoSeconds: number }>> {
    const userId = await me()
    const key = String(handle ?? '').trim().replace(/^@/, '').toLowerCase()
    if (!userId) return { success: false, error: 'Sign in to continue.' }
    if (!/^[a-z0-9_]{3,30}$/.test(key)) return { success: false, error: 'Enter an @handle, like @priya_s.' }
    const [target] = await db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username }).from(profiles)
        .where(and(eq(profiles.username, key), isNull(profiles.deletedAt))).limit(1)
    // The same answer whether the handle is free or taken by someone who isn't available: nothing to probe (B31).
    if (!target || target.id === userId) return { success: false, error: 'No account with that @handle.' }
    const blocked = await blockPersonAction(target.id, 'settings')
    return blocked.success ? { success: true, id: target.id, name: target.name ?? `@${target.username}`, undoSeconds: blocked.undoSeconds } : blocked
}

/** Your private note on a block, seen only by you (B30). */
export async function setBlockNoteAction(targetId: string, note: string): Promise<Result> {
    const userId = await me()
    if (!userId || !uuid.safeParse(targetId).success || typeof note !== 'string' || note.length > 500) return { success: false, error: 'Couldn’t save the note.' }
    await db.update(userBlocks).set({ note: note.trim() || null }).where(and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, targetId)))
    return { success: true }
}

/** Mute or unmute someone (B26): their posts, comments and messages in shared spaces fold for you. Nobody is told. */
export async function setMutedAction(targetId: string, muted: boolean): Promise<Result> {
    const userId = await me()
    if (!userId || !uuid.safeParse(targetId).success || targetId === userId) return { success: false, error: 'Couldn’t update this.' }
    if (await limited(userId)) return { success: false, error: 'You’re going a bit fast. Try again in a moment.' }
    if (muted) await db.insert(userMutes).values({ muterId: userId, mutedId: targetId }).onConflictDoNothing()
    else await db.delete(userMutes).where(and(eq(userMutes.muterId, userId), eq(userMutes.mutedId, targetId)))
    return { success: true }
}

/** The people you muted, newest first, for Settings → Privacy. */
export async function listMutedAction(): Promise<Result<{ people: Array<{ id: string; name: string; username: string | null; avatarUrl: string | null; mutedAt: string }> }>> {
    const userId = await me()
    if (!userId) return { success: false, error: 'Sign in to continue.' }
    const rows = await db.select({ id: profiles.id, fullName: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl, mutedAt: userMutes.createdAt })
        .from(userMutes).innerJoin(profiles, eq(profiles.id, userMutes.mutedId))
        .where(and(eq(userMutes.muterId, userId), isNull(profiles.deletedAt))).orderBy(sql`${userMutes.createdAt} DESC`).limit(500)
    return { success: true, people: rows.map((r) => ({ id: r.id, name: r.fullName || r.username || 'Member', username: r.username, avatarUrl: r.avatarUrl, mutedAt: r.mutedAt.toISOString() })) }
}

/**
 * "Ask to change team" (B48, K40): a member of a team inside an organization asks its admins to move them. It never
 * names anyone else and never says why, so nobody learns about a block.
 */
export async function askToChangeTeamAction(workspaceId: string): Promise<Result> {
    const userId = await me()
    if (!userId || !uuid.safeParse(workspaceId).success) return { success: false, error: 'Couldn’t send this.' }
    if (await limited(userId)) return { success: false, error: 'You’re going a bit fast. Try again in a moment.' }
    const [team] = await db.execute(sql`
        SELECT t.title, o.id AS org_id, o.slug AS org_slug, coalesce(p.full_name, p.username, 'A member') AS name,
               -- As JSON: the driver returns a uuid[] as the text "{...}", not an array.
               to_jsonb(array(SELECT o.owner_id UNION SELECT m.user_id FROM workspace_members m WHERE m.workspace_id = o.id AND m.role IN ('owner', 'admin'))) AS admins
        FROM workspaces t
        JOIN workspaces o ON o.id = t.parent_id AND o.kind = 'organization' AND o.deleted_at IS NULL
        JOIN workspace_members me ON me.workspace_id = t.id AND me.user_id = ${userId}::uuid
        JOIN profiles p ON p.id = ${userId}::uuid
        WHERE t.id = ${workspaceId}::uuid AND t.deleted_at IS NULL`) as unknown as Array<{ title: string; org_id: string; org_slug: string | null; name: string; admins: string[] }>
    if (!team) return { success: false, error: 'Only members of a team in an organization can ask this.' }
    // Kept for Members → Requests (report §25.5, decision 46), one per person and workspace.
    await db.execute(sql`
        UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{teamChangeRequests}',
            coalesce((SELECT jsonb_agg(r) FROM jsonb_array_elements(org_settings->'teamChangeRequests') r WHERE NOT (r->>'userId' = ${userId} AND r->>'workspaceId' = ${workspaceId})), '[]'::jsonb)
            || jsonb_build_array(jsonb_build_object('userId', ${userId}::text, 'workspaceId', ${workspaceId}::text, 'at', now())))
        WHERE id = ${team.org_id}::uuid`)
    await notifyOrg({
        orgId: team.org_id, eventKey: 'org.child_notice', actorId: userId, to: team.admins.filter((id) => id !== userId),
        title: `${team.name} asked to change team`, body: `They’re in ${team.title} and would like to be moved. No reason is given, so don’t ask for one.`,
        href: orgHref({ id: team.org_id, slug: team.org_slug }, '?tab=members'), sourceEventId: `team-change:${workspaceId}:${userId}:${new Date().toISOString().slice(0, 10)}`,
        refs: { projectId: workspaceId },
    })
    return { success: true }
}

/**
 * "Remove and block from this workspace" (B27), the owner's own decision after removing someone: they can't come back
 * by code, link, application or invitation (the database keeps it). Not a personal block.
 */
export async function blockFromWorkspaceAction(workspaceId: string, targetId: string): Promise<Result> {
    const userId = await me()
    if (!userId || !uuid.safeParse(workspaceId).success || !uuid.safeParse(targetId).success || targetId === userId) return { success: false, error: 'Couldn’t block this person here.' }
    const done = await db.execute(sql`
        INSERT INTO org_join_blocks (org_id, user_id, blocked_by)
        SELECT w.id, ${targetId}::uuid, ${userId}::uuid FROM workspaces w
        WHERE w.id = ${workspaceId}::uuid AND w.owner_id = ${userId}::uuid AND w.kind <> 'organization' AND w.deleted_at IS NULL
        ON CONFLICT DO NOTHING RETURNING org_id`) as unknown as unknown[]
    return done.length ? { success: true } : { success: false, error: 'Only the owner can block someone from this workspace.' }
}
