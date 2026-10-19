import { randomUUID } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { db } from '@/lib/db'
import { onboardingSubmissions } from '@/lib/db/schema'
import type { OnboardingError } from '@/lib/onboarding/errors'

const ONBOARDING_PROCESSING_STALE_MS = 60_000

/**
 * Submission states (API-002, API-003):
 *   processing         one attempt owns the row; `attempt_token` identifies that attempt.
 *   completed          replayed as the stored success.
 *   failed, terminal   (error.retryable is not true) replayed as the stored error.
 *   failed, retryable  reacquired by the next request with the same key.
 *   processing, stale  reacquired after ONBOARDING_PROCESSING_STALE_MS.
 * Every takeover and every finalization is a compare-and-swap on (status, attempt_token), so a slow
 * earlier attempt can never overwrite the outcome of the attempt that replaced it.
 */
export type OnboardingAttempt = { submissionId: string; attemptToken: string }

export async function beginOnboardingSubmission(params: {
    userId: string
    idempotencyKey: string
}): Promise<
    | ({ mode: 'process' } & OnboardingAttempt)
    | { mode: 'replay'; response: { success: boolean; needsMetadataSync?: boolean; error?: OnboardingError } }
    | { mode: 'in-progress' }
> {
    const now = new Date()
    const attemptToken = randomUUID()
    const inserted = await db
        .insert(onboardingSubmissions)
        .values({
            userId: params.userId,
            idempotencyKey: params.idempotencyKey,
            status: 'processing',
            response: {},
            attemptToken,
            createdAt: now,
            updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: onboardingSubmissions.id })

    if (inserted.length > 0) {
        return { mode: 'process', submissionId: inserted[0]!.id, attemptToken }
    }

    const existing = await db.query.onboardingSubmissions.findFirst({
        where: and(
            eq(onboardingSubmissions.userId, params.userId),
            eq(onboardingSubmissions.idempotencyKey, params.idempotencyKey)
        ),
        columns: {
            id: true,
            status: true,
            response: true,
            updatedAt: true,
            attemptToken: true,
        },
    })

    if (!existing) {
        return { mode: 'in-progress' }
    }

    const stored = (existing.response || {}) as {
        success?: boolean
        needsMetadataSync?: boolean
        error?: OnboardingError
    }
    const replay = () => ({
        mode: 'replay' as const,
        response: {
            success: stored.success === true,
            needsMetadataSync: stored.needsMetadataSync === true,
            error: stored.error,
        },
    })

    if (existing.status === 'completed') return replay()
    if (existing.status === 'failed' && stored.error?.retryable !== true) return replay()

    const reacquirable =
        existing.status === 'failed' ||
        (existing.status === 'processing' && now.getTime() - existing.updatedAt.getTime() > ONBOARDING_PROCESSING_STALE_MS)
    if (!reacquirable) {
        return { mode: 'in-progress' }
    }

    const reacquired = await db
        .update(onboardingSubmissions)
        .set({
            status: 'processing',
            response: {},
            attemptToken,
            updatedAt: now,
        })
        .where(
            and(
                eq(onboardingSubmissions.id, existing.id),
                eq(onboardingSubmissions.status, existing.status),
                eq(onboardingSubmissions.attemptToken, existing.attemptToken)
            )
        )
        .returning({ id: onboardingSubmissions.id })

    if (reacquired.length === 0) {
        return { mode: 'in-progress' }
    }

    return { mode: 'process', submissionId: reacquired[0]!.id, attemptToken }
}

/** Records this attempt's outcome unless a newer attempt has taken the row over. */
export async function finalizeOnboardingSubmission(params: OnboardingAttempt & {
    status: 'completed' | 'failed'
    response: Record<string, unknown>
}) {
    const finalized = await db
        .update(onboardingSubmissions)
        .set({
            status: params.status,
            response: params.response,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(onboardingSubmissions.id, params.submissionId),
                eq(onboardingSubmissions.status, 'processing'),
                eq(onboardingSubmissions.attemptToken, params.attemptToken)
            )
        )
        .returning({ id: onboardingSubmissions.id })
    if (finalized.length === 0) {
        console.warn('Onboarding attempt superseded; outcome not recorded', { submissionId: params.submissionId })
    }
}

