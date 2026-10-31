import { NextRequest } from 'next/server';
import { eq, sql, and, isNull } from 'drizzle-orm';

import { enforceRouteLimit, getRequestIp, jsonError, jsonSuccess } from '@/app/api/v1/_shared';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { db } from '@/lib/db';
import { workspaces } from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import { getRedisClient } from '@/lib/redis';
import { validateCsrf } from '@/lib/security/csrf';
import { DEV_CSRF_SECRET_FALLBACK } from '@/lib/security/csrf-constants';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { staffRoleOf } from '@/lib/trust/staff';
import { recordWorkspaceView } from '@/lib/workspaces/view-record';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEW_WINDOW_SECONDS = 24 * 60 * 60;
const IP_LIMIT_PER_HOUR = 120;
const SPIKE_PER_HOUR = 500;

const NO_CONTENT = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });

// One workspace, one counted view: the existing trigger announces the new number to its readers.
// ponytail: a direct write per counted view. Ceiling: roughly tens per second on one workspace. Upgrade: buffer it through lib/counters/redis-flush.
async function incrementViewCount(workspaceId: string) {
    const rows = await db.update(workspaces)
        .set({ viewCount: sql`${workspaces.viewCount} + 1` })
        .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
        .returning({ id: workspaces.id });
    return rows.length > 0;
}

/** Same answer for every outcome, so nobody can use this to learn whether a private workspace exists. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const csrfError = validateCsrf(request);
    if (csrfError) return csrfError;
    const { id } = await context.params;
    if (!UUID.test(id)) return NO_CONTENT();

    const ip = getRequestIp(request);
    const outcome = await recordWorkspaceView({ workspaceId: id, ip: ip === 'unknown' ? null : ip, userAgent: request.headers.get('user-agent') }, {
        secret: process.env.CSRF_TOKEN_SECRET?.trim() || DEV_CSRF_SECRET_FALLBACK,
        resolveViewer: async () => {
            const { userId, user } = await getViewerAuthContext();
            return userId ? { id: userId, isStaff: staffRoleOf(user) !== null } : null;
        },
        readAccess: async (workspaceId, userId) => {
            const access = await getWorkspaceAccessById(workspaceId, userId);
            return { canRead: Boolean(access.project && access.canRead), isTeam: access.isOwner || access.isMember || access.isInheritedAdmin };
        },
        allowIp: async (key) => (await consumeRateLimit(key, IP_LIMIT_PER_HOUR, 60 * 60, { failMode: 'allow' })).allowed,
        claimSlot: async (key) => {
            const redis = getRedisClient();
            if (!redis) throw new Error('Redis unavailable');
            return (await redis.set(key, '1', { nx: true, ex: VIEW_WINDOW_SECONDS })) !== null;
        },
        releaseSlot: async (key) => { await getRedisClient()?.del(key); },
        increment: incrementViewCount,
    });

    logger.metric('workspace.view', { module: 'workspaces', outcome, sampleRate: outcome === 'write_failed' || outcome === 'unavailable' ? 1 : 0.1 });
    if (outcome === 'counted') {
        const spike = await consumeRateLimit(`workspace-view-spike:${id}`, SPIKE_PER_HOUR, 60 * 60, { failMode: 'allow' }).catch(() => null);
        if (spike && !spike.allowed) logger.warn('workspace.view.spike', { module: 'workspaces', projectId: id });
    }
    return NO_CONTENT();
}

/** The live numbers, for catching up after a dropped connection or a card coming on screen. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    if (!UUID.test(id)) return jsonError('Workspace not found', 404, 'NOT_FOUND');
    const { userId } = await getViewerAuthContext();
    if (!userId) return jsonError('Sign in to continue', 401, 'UNAUTHORIZED');
    const limited = await enforceRouteLimit(request, 'api:v1:workspaces:view-counts', 240, 60, 'publicRead', userId);
    if (limited) return limited;

    const access = await getWorkspaceAccessById(id, userId);
    if (!access.project || !access.canRead) return jsonError('Workspace not found', 404, 'NOT_FOUND');
    const [row] = await db.select({ viewCount: workspaces.viewCount, followersCount: workspaces.followersCount })
        .from(workspaces).where(eq(workspaces.id, id)).limit(1);
    if (!row) return jsonError('Workspace not found', 404, 'NOT_FOUND');
    return jsonSuccess(row, undefined, { headers: { 'Cache-Control': 'private, no-store' } });
}
