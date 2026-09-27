import { NextRequest } from 'next/server';
import { jsonSuccess, jsonError } from '@/app/api/v1/_envelope';
import { enforceRouteLimit } from '@/app/api/v1/_shared';
import { db } from '@/lib/db';
import { isTransientDbError, readDbErrorCode, withDbRetry } from '@/lib/db/retry';
import { profiles } from '@/lib/db/schema';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { validateCsrf } from '@/lib/security/csrf';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LAST_SEEN_WINDOW_MS = 5 * 60_000;

export async function POST(request: NextRequest) {
    try {
        const csrfError = validateCsrf(request);
        if (csrfError) return csrfError;
        const rlResponse = await enforceRouteLimit(request, 'api:v1:presence:heartbeat', 30, 60);
        if (rlResponse) return rlResponse;

        const auth = await getViewerAuthContext();
        if (!auth.userId || !auth.user) return jsonError('Not authenticated', 401, 'UNAUTHORIZED');

        const userId = auth.userId;
        try {
            const updated = await withDbRetry("presence.heartbeat.last_active", () => db
                .update(profiles)
                .set({ lastActiveAt: new Date() })
                .where(and(
                    eq(profiles.id, userId),
                    or(isNull(profiles.lastActiveAt), lt(profiles.lastActiveAt, new Date(Date.now() - LAST_SEEN_WINDOW_MS))),
                ))
                .returning({ id: profiles.id }), { module: "presence" });
            return jsonSuccess({ updated: updated.length > 0 });
        } catch (error) {
            if (!isTransientDbError(error)) throw error;
            logger.warn("presence.heartbeat_last_active_skipped", {
                module: "presence",
                userId,
                errorCode: readDbErrorCode(error),
                error: error instanceof Error ? error.message : String(error),
            });
            return jsonSuccess({ updated: false, skipped: "transient_db" });
        }
    } catch (error) {
        console.error('Presence heartbeat error:', error);
        return jsonError('Internal server error', 500, 'INTERNAL_ERROR');
    }
}
