import { and, desc, eq } from 'drizzle-orm';

import { jsonError, jsonSuccess, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { db } from '@/lib/db';
import { profileAuditEvents } from '@/lib/db/schema';

/** When the person last exported their data (the export itself is limited to once an hour). */
export async function GET() {
    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) return auth.response ?? jsonError('Sign in to continue', 401, 'UNAUTHORIZED');
    const [last] = await db
        .select({ createdAt: profileAuditEvents.createdAt })
        .from(profileAuditEvents)
        .where(and(eq(profileAuditEvents.userId, auth.user.id), eq(profileAuditEvents.eventType, 'account_data_exported')))
        .orderBy(desc(profileAuditEvents.createdAt))
        .limit(1);
    return jsonSuccess({ lastExportedAt: last?.createdAt.toISOString() ?? null }, undefined, { headers: { 'Cache-Control': 'private, no-store' } });
}
