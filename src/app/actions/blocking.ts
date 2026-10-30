'use server'

import { and, eq, isNull, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { z } from 'zod'

import { db } from '@/lib/db'
import { profiles, userBlocks } from '@/lib/db/schema'
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
