import { getRequestId, jsonError, jsonSuccess, logApiRoute, requireAuthenticatedUser } from '@/app/api/v1/_shared';
import { logger } from '@/lib/logger';
import { validateCsrf } from '@/lib/security/csrf';
import { withIdempotentRoute } from '@/lib/security/idempotency';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { z } from 'zod';
import { scheduleAccountDeletionForUser } from '@/lib/account/deletion';
import { inngest } from '@/inngest/client';
import { createSignedJobRequestToken } from '@/lib/security/job-request';
import { resolveDestructiveStepUp } from '@/lib/security/destructive-step-up';
import { resolveStepUpCapabilities } from '@/lib/security/step-up-capabilities';
import { queueCounterRefreshBestEffort } from '@/lib/my-work/counter-buffer';
import { revokeAllExtensionSessionsForUser } from '@/lib/security/extension-token-revocation';
import { queueSecurityEmail } from '@/lib/email/security-queue';
import { recordSecurityEvent } from '@/lib/security/audit';

const ACCOUNT_DELETE_CONFIRM_TEXT = 'DELETE';
// Accounts with no password, authenticator or recovery code prove possession by a fresh sign-in.
const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

const deleteAccountBodySchema = z.object({
    confirmationText: z.string().max(50),
    reason: z.string().max(1000).optional(),
});



export async function DELETE(request: Request) {
    const startedAt = Date.now();
    const requestId = getRequestId(request);
    const idempotencyKey = request.headers.get('idempotency-key') || undefined;

    // CSRF check — uses shared validation utility
    const csrfError = validateCsrf(request);
    if (csrfError) {
        logApiRoute(request, {
            requestId,
            action: 'account.delete',
            startedAt,
            success: false,
            status: 403,
            errorCode: 'FORBIDDEN',
        });
        return csrfError;
    }

    const auth = await requireAuthenticatedUser();
    if (auth.response || !auth.user) {
        logApiRoute(request, {
            requestId,
            action: 'account.delete',
            startedAt,
            success: false,
            status: 401,
            errorCode: 'UNAUTHORIZED',
        });
        return auth.response ?? jsonError('Not authenticated', 401, 'UNAUTHORIZED');
    }
    const user = auth.user;

    return withIdempotentRoute(request, { namespace: 'account.delete', scopeId: user.id }, async () => {
    try {
        let confirmationText = '';
        let reason: string | undefined;
        try {
            const rawBody = await request.json();
            const bodyParse = deleteAccountBodySchema.safeParse(rawBody);
            if (bodyParse.success) {
                confirmationText = bodyParse.data.confirmationText;
                reason = bodyParse.data.reason;
            } else {
                logApiRoute(request, {
                    requestId,
                    action: 'account.delete',
                    startedAt,
                    success: false,
                    status: 400,
                    errorCode: 'BAD_REQUEST',
                });
                return jsonError(
                    bodyParse.error.issues[0]?.message ?? 'Invalid request body',
                    400,
                    'BAD_REQUEST',
                );
            }
        } catch {
            confirmationText = '';
        }

        const fail = (message: string, status: number, errorCode: Parameters<typeof jsonError>[2], details?: unknown) => {
            logApiRoute(request, { requestId, action: 'account.delete', startedAt, success: false, status, errorCode });
            return jsonError(message, status, errorCode, details);
        };
        if (auth.extensionSessionId) return fail('Account deletion requires a browser session', 403, 'FORBIDDEN');
        // The person types their own email or username (or the word DELETE): something only they would type.
        const username = typeof user.user_metadata?.username === 'string' ? user.user_metadata.username : '';
        const accepted = new Set([ACCOUNT_DELETE_CONFIRM_TEXT, user.email ?? '', username].map((value) => value.trim().toUpperCase()).filter(Boolean));
        if (!accepted.has(confirmationText.trim().toUpperCase())) return fail('Confirmation required', 400, 'BAD_REQUEST');

        // AUTH-006: a server-verified, unexpired step-up proves possession; sending
        // an OTP does not. Accounts with no step-up method need a fresh sign-in.
        const stepUp = await resolveDestructiveStepUp(auth.supabase, user.id);
        if (!stepUp.ok) {
            const { availableMethods, primaryTotpFactorId } = await resolveStepUpCapabilities({ supabase: auth.supabase, user });
            // The sign-in time of *this* session (verified JWT amr), not the account's last sign-in anywhere.
            const { data: claimsData } = await auth.supabase.auth.getClaims();
            const amr = (claimsData?.claims?.amr ?? []) as Array<string | { timestamp?: number }>;
            const signedInAtMs = Math.max(0, ...amr.map((entry) => (typeof entry === "object" && entry.timestamp ? entry.timestamp * 1000 : 0)));
            const freshSignIn = availableMethods.length === 0 && signedInAtMs > 0 && Date.now() - signedInAtMs <= RECENT_SIGN_IN_MS;
            if (!freshSignIn) {
                return fail(
                    availableMethods.length ? 'Verify your identity to delete your account' : 'Sign in again, then delete your account within 10 minutes',
                    403,
                    'STEP_UP_REQUIRED',
                    { availableMethods, factorId: primaryTotpFactorId ?? null },
                );
            }
        }

        // Only attempts that got past the step-up count, so a step-up retry doesn't burn the budget.
        // Failing open here would let a stolen session retry without limit, so a limiter outage refuses instead.
        try {
            const rateLimitResult = await consumeRateLimit(`account-delete:${user.id}`, 3, 3600);
            if (!rateLimitResult.allowed) return fail('Too many deletion attempts. Please try again later.', 429, 'RATE_LIMITED');
        } catch (rlErr) {
            logger.warn('Rate limit check error:', { module: 'api', error: rlErr instanceof Error ? rlErr.message : String(rlErr) });
            return fail('Account deletion is temporarily unavailable. Please try again shortly.', 503, 'UNAVAILABLE');
        }

        const result = await scheduleAccountDeletionForUser({
            userId: user.id,
            email: user.email || '',
            username: typeof user.user_metadata?.username === 'string' ? user.user_metadata.username : null,
            reason: reason || null,
        });
        if (!result.ok && result.code === 'OWNS_ORG') {
            return fail(`You own ${result.orgs.map((org) => org.title).join(', ')}. Transfer ownership or delete ${result.orgs.length === 1 ? 'it' : 'them'} first.`, 409, 'CONFLICT');
        }
        if (!result.ok) return fail('Account deletion is already scheduled', 409, 'CONFLICT');

        await recordSecurityEvent({ userId: user.id, eventType: 'account_deletion_scheduled', request, metadata: { hardDeleteAt: result.hardDeleteAt.toISOString() } }).catch(() => undefined);
        await queueSecurityEmail(user.id, 'account_deletion_scheduled', { hardDeleteAt: result.hardDeleteAt.toISOString() }, `${result.deletionId}:scheduled`);

        if (result.affectedUserIds.length > 0) {
            await queueCounterRefreshBestEffort(result.affectedUserIds).catch((error: unknown) =>
                logger.warn('account.counter-refresh.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) }));
        }
        // The worker's claim is conditional and the daily cron re-dispatches any
        // storage phase stalled for an hour, so a lost dispatch delays, never skips.
        await inngest.send({
            name: 'account/cleanup',
            data: {
                userId: user.id,
                deletionId: result.deletionId,
                jobSignature: createSignedJobRequestToken({ kind: 'account/cleanup', actorId: user.id, subjectId: result.deletionId }),
            },
        }).catch((error: unknown) =>
            logger.warn('account.inngest-dispatch.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) }));
        await revokeAllExtensionSessionsForUser(user.id).catch((error: unknown) =>
            logger.warn('account.extension-revoke.failed', { module: 'account', error: error instanceof Error ? error.message : String(error) }));
        await auth.supabase.auth.signOut().catch(() => undefined);

        logApiRoute(request, {
            requestId,
            action: 'account.delete',
            startedAt,
            success: true,
            status: 200,
        });
        return jsonSuccess({
            deletionId: result.deletionId,
            hardDeleteAt: result.hardDeleteAt.toISOString(),
        });
    } catch (error) {
        logger.error('Account delete route error:', { module: 'api', error: error instanceof Error ? error.message : String(error) });
        logApiRoute(request, {
            requestId,
            action: 'account.delete',
            startedAt,
            success: false,
            status: 500,
            errorCode: 'INTERNAL_ERROR',
        });
        return jsonError('Failed to schedule account deletion', 500, 'INTERNAL_ERROR');
    }
    });
}
