import { getRequestId, jsonError, logApiRoute, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { createAccountExportStream } from '@/lib/account/export-stream';
import { logger } from '@/lib/logger';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { recordSecurityEvent } from '@/lib/security/audit';

export async function GET(request: Request) {
    const startedAt = Date.now();
    const requestId = getRequestId(request);

    try {
        const auth = await requireAuthenticatedUser();

        if (auth.response || !auth.user) {
            logApiRoute(request, {
                requestId,
                action: 'account.export',
                startedAt,
                success: false,
                status: 401,
                errorCode: 'UNAUTHORIZED',
            });
            return auth.response ?? jsonError('Sign in to continue', 401, 'UNAUTHORIZED');
        }
        const user = auth.user;

        // Rate limit: 1 export per hour
        const rateLimitResult = await consumeRateLimit(
            `account-export:${user.id}`,
            1,
            3600,
        );
        if (!rateLimitResult.allowed) {
            logApiRoute(request, {
                requestId,
                action: 'account.export',
                startedAt,
                success: false,
                status: 429,
                errorCode: 'RATE_LIMITED',
            });
            return jsonError(
                'You can only export your data once per hour. Try again later.',
                429,
                'RATE_LIMITED',
            );
        }

        const stream = await createAccountExportStream(user.id, request.signal);
        // Recorded once the file is on its way, so the settings page can say when it was last made.
        await recordSecurityEvent({ userId: user.id, eventType: 'account_data_exported', request }).catch(() => undefined);

        logApiRoute(request, {
            requestId,
            action: 'account.export',
            startedAt,
            success: true,
            status: 200,
        });

        return new Response(stream, {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="account-data-${new Date().toISOString().slice(0, 10)}.json"`,
                'Cache-Control': 'no-store, no-cache, must-revalidate',
            },
        });
    } catch (error) {
        logger.error('Account export route error:', { module: 'api', error: error instanceof Error ? error.message : String(error) });
        logApiRoute(request, {
            requestId,
            action: 'account.export',
            startedAt,
            success: false,
            status: 500,
            errorCode: 'INTERNAL_ERROR',
        });
        return jsonError('Couldn’t export account data', 500, 'INTERNAL_ERROR');
    }
}
