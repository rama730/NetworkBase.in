import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { profileAuditEvents } from '@/lib/db/schema'

/** The same 30 days updateProfileAction enforces; null when the username can change now (or the lookup fails: the save re-checks). */
export async function getUsernameNextChangeAt(userId: string): Promise<string | null> {
    const last = await db.query.profileAuditEvents.findFirst({
        columns: { createdAt: true },
        where: and(eq(profileAuditEvents.userId, userId), eq(profileAuditEvents.eventType, 'username_changed')),
        orderBy: [desc(profileAuditEvents.createdAt)],
    }).catch(() => undefined)
    const next = last ? last.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000 : 0
    return next > Date.now() ? new Date(next).toISOString() : null
}
