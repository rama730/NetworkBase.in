'use server'

import { banIfBlockedIdentity } from '@/lib/trust/standing'
import { acceptOrgEmailInvites, joinOrgByCode } from '@/lib/organizations/join'
import { normalizeJoinCode, type OrgJoinOutcome } from '@/lib/organizations/join-rules'
import { after } from 'next/server'
import { headers } from 'next/headers'
import { and, eq, sql } from 'drizzle-orm'
import type { User } from '@supabase/supabase-js'
import { db } from '@/lib/db'
import { onboardingDrafts, onboardingEvents, profiles } from '@/lib/db/schema'
import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding/contracts'
import { sanitizeOnboardingTelemetryBatch, type OnboardingEventInput } from '@/lib/onboarding/events'
import { onboardingError, type OnboardingError } from '@/lib/onboarding/errors'
import { syncOnboardingClaims } from '@/lib/onboarding/claims'
import { consumeUsernameCheckBudget } from '@/lib/onboarding/username-check'
import {
    ONBOARDING_SCHEMA_VERSION,
    ONBOARDING_SERVER_DRAFT_TTL_MS,
    clampCompletedThrough,
    clampOnboardingStep,
} from '@/lib/onboarding/state'
import {
    claimPrimaryAlias,
    findUnavailableUsernames,
    generateDeterministicUsernameCandidates,
    getUsernameAvailability,
    mapUsernamePersistenceError,
} from '@/lib/usernames/service'
import { consumeRateLimit } from '@/lib/security/rate-limit'
import { getTrustedHeadersIp } from '@/lib/security/request-ip'
import { isSafeHttpUrl } from '@/lib/security/urls'
import { createClient } from '@/lib/supabase/server'
import { isEmailVerified } from '@/lib/auth/email-verification'
import {
    normalizeOnboardingPayload,
    parseOnboardingDraft,
    type OnboardingDraft,
    type OnboardingPayload,
    type OnboardingPayloadInput,
} from '@/lib/validations/onboarding'
import { normalizeUsername, validateUsername } from '@/lib/validations/username'
import { syncProfileSkills } from '@/lib/skills/service'
import { ensureProfileShell } from '@/lib/services/profile-service'
import { enqueueSupersededProfileImages } from '@/lib/profile/image-cleanup'
import { queueEmail, wakeEmailWorker } from '@/lib/email/outbox'

const ONBOARDING_COMPLETE_LIMIT = 10
const ONBOARDING_COMPLETE_WINDOW_SECONDS = 60
const ONBOARDING_COMPLETE_IP_LIMIT = 30
const ONBOARDING_COMPLETE_FINGERPRINT_LIMIT = 20

type FailedResult = { success: false; error: string; errorDetails: OnboardingError }

function failed(details: OnboardingError): FailedResult {
    return { success: false, error: details.message, errorDetails: details }
}

async function getViewer() {
    const supabase = await createClient()
    const [{ data: authData }, headerStore] = await Promise.all([supabase.auth.getUser(), headers()])
    return {
        user: authData.user || null,
        ipAddress: getTrustedHeadersIp(headerStore) ?? 'unknown',
        userAgent: headerStore.get('user-agent') || 'unknown',
    }
}

/** Runs after the response when there is a request to run after; a plain background call otherwise (tests, scripts). */
function afterResponse(task: () => Promise<unknown>) {
    const run = () => task().catch((error) => console.error('Onboarding follow-up failed:', error))
    try {
        after(run)
    } catch {
        void run()
    }
}

type EventRow = { eventType: string; step?: number | null; metadata?: Record<string, unknown> }

function writeEvents(executor: Pick<typeof db, 'insert'>, userId: string, events: EventRow[]) {
    if (events.length === 0) return Promise.resolve()
    return executor.insert(onboardingEvents).values(
        events.map((event) => ({
            userId,
            eventType: event.eventType,
            step: typeof event.step === 'number' ? clampOnboardingStep(event.step) : null,
            metadata: event.metadata ?? {},
        })),
    )
}

function describeInvalid(error: unknown): string {
    const issue = (error as { issues?: Array<{ path: PropertyKey[]; message: string }> })?.issues?.[0]
    if (!issue) return 'Some details look invalid. Review and try again.'
    const field = issue.path.length > 0 ? `${String(issue.path[0])}: ` : ''
    return `${field}${issue.message}`
}

function mapOnboardingPersistenceError(error: unknown): OnboardingError {
    const usernameError = mapUsernamePersistenceError(error)
    if (usernameError.code !== 'DB_ERROR') return usernameError
    const code = (error as { code?: string })?.code
    if (code === '22P02') return onboardingError('INVALID_INPUT', 'Invalid profile setup input')
    return onboardingError('DB_ERROR', 'Couldn’t complete onboarding right now', true)
}

async function ensureUsernameIsAvailable(params: { username: string; userId: string }) {
    try {
        const availability = await getUsernameAvailability({ username: params.username, viewerId: params.userId })
        if (!availability.available) {
            return {
                ok: false as const,
                error: availability.error || onboardingError(availability.code || 'USERNAME_TAKEN', availability.message),
            }
        }
        return { ok: true as const }
    } catch (error) {
        console.error('Error checking username availability:', error)
        return {
            ok: false as const,
            error: onboardingError('DB_ERROR', 'Couldn’t verify username availability', true),
        }
    }
}

async function ensureOnboardingProfileShell(params: {
    userId: string
    userEmail: string | null | undefined
    metadata: User['user_metadata']
}): Promise<{ success: true } | { success: false; error: OnboardingError }> {
    const result = await ensureProfileShell(params)
    if (result.success) return result
    if (result.error === 'missing_email') {
        return {
            success: false,
            error: onboardingError('INVALID_INPUT', 'Account email is missing. Re-authenticate.'),
        }
    }
    return { success: false, error: onboardingError('DB_ERROR', 'Couldn’t prepare your account profile', true) }
}

function profileValues(params: { userEmail: string; payload: OnboardingPayload; avatarUrl: string | null }) {
    const { payload } = params
    return {
        email: params.userEmail,
        username: payload.username,
        fullName: payload.fullName,
        avatarUrl: params.avatarUrl,
        headline: payload.headline || null,
        bio: payload.bio || null,
        location: payload.location || null,
        website: payload.website || null,
        skills: payload.skills,
        interests: payload.interests,
        openTo: payload.openTo,
        messagePrivacy: payload.messagePrivacy,
        socialLinks: payload.socialLinks,
        experienceLevel: payload.experienceLevel || null,
        hoursPerWeek: payload.hoursPerWeek || null,
        genderIdentity: payload.genderIdentity || null,
        pronouns: payload.pronouns || null,
        visibility: payload.visibility,
    }
}

export type OnboardingOrgJoin = { title: string; slug: string | null; outcome: OrgJoinOutcome }

export async function completeOnboarding(
    data: OnboardingPayloadInput & { telemetry?: OnboardingEventInput[]; pendingJoinCode?: string },
): Promise<{ success: boolean; error?: string; errorDetails?: OnboardingError; joined?: OnboardingOrgJoin | null }> {
    const telemetry = sanitizeOnboardingTelemetryBatch(data.telemetry)
    let userId: string | null = null

    // The server, not the browser, records how a submit ended, so the success rate stays honest.
    const finish = <T extends { success: boolean }>(result: T, metadata: Record<string, unknown> = {}): T => {
        const id = userId
        if (id) {
            afterResponse(() =>
                writeEvents(db, id, [
                    { eventType: 'submit_start', step: ONBOARDING_TOTAL_STEPS },
                    ...telemetry,
                    result.success
                        ? { eventType: 'submit_success', step: ONBOARDING_TOTAL_STEPS, metadata }
                        : { eventType: 'submit_error', step: ONBOARDING_TOTAL_STEPS, metadata },
                ]),
            )
        }
        return result
    }

    try {
        // Auth first: nothing is parsed for a caller who is not signed in.
        const { user, ipAddress, userAgent } = await getViewer()
        if (!user) return failed(onboardingError('NOT_AUTHENTICATED', 'Your session ended. Sign in again.'))
        userId = user.id
        if (!isEmailVerified(user as unknown as Record<string, unknown>)) {
            return finish(failed(onboardingError('INVALID_INPUT', 'Verify your email before completing profile setup.')), {
                reason: 'INVALID_INPUT',
            })
        }

        const username = normalizeUsername(data.username)
        const usernameValidation = validateUsername(username)
        if (!usernameValidation.valid) {
            return finish(failed(onboardingError('USERNAME_INVALID', usernameValidation.message)), { reason: 'USERNAME_INVALID' })
        }
        let payload: OnboardingPayload
        try {
            payload = normalizeOnboardingPayload({ ...data, username })
        } catch (error) {
            return finish(failed(onboardingError('INVALID_INPUT', describeInvalid(error))), { reason: 'INVALID_INPUT' })
        }

        const ua = userAgent.toLowerCase().slice(0, 120) || 'unknown'
        const [userRate, ipRate, fingerprintRate] = await Promise.all([
            consumeRateLimit(`onboarding:complete:user:${user.id}`, ONBOARDING_COMPLETE_LIMIT, ONBOARDING_COMPLETE_WINDOW_SECONDS),
            consumeRateLimit(`onboarding:complete:ip:${ipAddress}`, ONBOARDING_COMPLETE_IP_LIMIT, ONBOARDING_COMPLETE_WINDOW_SECONDS),
            consumeRateLimit(
                `onboarding:complete:fingerprint:${ipAddress}:${ua}`,
                ONBOARDING_COMPLETE_FINGERPRINT_LIMIT,
                ONBOARDING_COMPLETE_WINDOW_SECONDS,
            ),
        ])
        if (!userRate.allowed || !ipRate.allowed || !fingerprintRate.allowed) {
            return finish(failed(onboardingError('RATE_LIMITED', 'Too many attempts. Wait a minute and try again.', true)), {
                reason: 'RATE_LIMITED',
            })
        }

        if (!user.email) {
            return finish(failed(onboardingError('INVALID_INPUT', 'Account email is missing. Re-authenticate.')), {
                reason: 'INVALID_INPUT',
            })
        }
        const userEmail = user.email
        const shell = await ensureOnboardingProfileShell({ userId: user.id, userEmail, metadata: user.user_metadata })
        if (!shell.success) return finish(failed(shell.error), { reason: shell.error.code })

        const availability = await ensureUsernameIsAvailable({ username: payload.username, userId: user.id })
        if (!availability.ok) return finish(failed(availability.error), { reason: availability.error.code })

        // The provider photo is user-editable metadata: it passes the same safe-URL gate as an uploaded one.
        const metadataAvatar = user.user_metadata?.avatar_url
        const avatarUrl =
            payload.avatarUrl || (typeof metadataAvatar === 'string' && isSafeHttpUrl(metadataAvatar) ? metadataAvatar : null)
        const values = profileValues({ userEmail, payload, avatarUrl })
        const now = new Date()

        const outcome = await db.transaction(async (tx) => {
            // The row lock is the whole idempotency story: a second or repeated completion waits here, sees
            // 'completed' and writes nothing, so a finished account can never be rewritten through this action.
            const [existing] = await tx
                .select({ avatarUrl: profiles.avatarUrl, onboardingStatus: profiles.onboardingStatus })
                .from(profiles)
                .where(eq(profiles.id, user.id))
                .for('update')
            if (existing?.onboardingStatus === 'completed') return { alreadyCompleted: true as const }

            const completion = {
                onboardingStatus: 'completed' as const,
                onboardingCompletedAt: now,
                onboardingVersion: ONBOARDING_SCHEMA_VERSION,
                updatedAt: now,
            }
            await tx
                .insert(profiles)
                .values({ id: user.id, ...values, ...completion })
                .onConflictDoUpdate({ target: profiles.id, set: { ...values, ...completion } })

            const resolvedSkills = await syncProfileSkills(tx, user.id, payload.skills)
            await tx
                .update(profiles)
                .set({ skills: resolvedSkills.map((skill) => skill.name) })
                .where(eq(profiles.id, user.id))

            await claimPrimaryAlias(tx, user.id, payload.username)
            await tx.delete(onboardingDrafts).where(eq(onboardingDrafts.userId, user.id))
            await queueEmail(tx, { kind: 'welcome', eventId: user.id, userId: user.id })

            return { alreadyCompleted: false as const, previousAvatarUrl: existing?.avatarUrl ?? null }
        })

        if (outcome.alreadyCompleted) return finish({ success: true as const }, { alreadyCompleted: true })

        // Ban evasion (trust and safety F15): an identity we banned stays banned under a new account.
        await banIfBlockedIdentity(user.id).catch((error) => console.error('Ban identity check failed:', error))

        // The next page load reads this claim, so it is written before the response. If it fails the
        // database still says completed and the gate heals the claim itself (lib/onboarding/completion.ts).
        const claimSynced = await syncOnboardingClaims({
            userId: user.id,
            userMetadata: user.user_metadata,
            appMetadata: user.app_metadata,
            profile: { username: payload.username, fullName: payload.fullName, avatarUrl },
        })

        const joined = await joinOrgsAfterOnboarding(user.id, userEmail, data.pendingJoinCode)

        afterResponse(async () => {
            await wakeEmailWorker()
            if (outcome.previousAvatarUrl && outcome.previousAvatarUrl !== avatarUrl) {
                await enqueueSupersededProfileImages(user.id, [outcome.previousAvatarUrl])
            }
        })
        return finish({ success: true as const, joined }, { claimSynced })
    } catch (error) {
        console.error('Error completing onboarding:', error)
        const details = mapOnboardingPersistenceError(error)
        return finish(failed(details), { reason: details.code })
    }
}

/**
 * After setup: matching email invites are accepted, then the code from /join/CODE joins or sends a request,
 * with no extra click (decisions 133, 134). Never fails the onboarding itself.
 */
async function joinOrgsAfterOnboarding(userId: string, email: string, rawCode: string | undefined): Promise<OnboardingOrgJoin | null> {
    try {
        await acceptOrgEmailInvites(userId, email)
        const code = rawCode ? normalizeJoinCode(rawCode) : null
        const result = code ? await joinOrgByCode(userId, code) : null
        return result ? { title: result.org.title, slug: result.org.slug, outcome: result.outcome } : null
    } catch (error) {
        console.error('Joining an organization after onboarding failed:', error)
        return null
    }
}

export async function getUsernameSuggestions(fullName: string): Promise<{ suggestions: string[] }> {
    const { user, ipAddress, userAgent } = await getViewer()
    if (!user) return { suggestions: [] }

    // Which names are free is the answer to "is this username taken?", so it spends the same budget as the check.
    const budget = await consumeUsernameCheckBudget({ viewerKey: user.id, viewerId: user.id, ipAddress, userAgent })
    if (!budget.allowed) return { suggestions: [] }

    const candidates = generateDeterministicUsernameCandidates(String(fullName ?? '').slice(0, 80))
        .slice(0, 12)
        .map((candidate) => normalizeUsername(candidate))
    if (candidates.length === 0) return { suggestions: [] }

    try {
        const taken = await findUnavailableUsernames(candidates)
        return { suggestions: candidates.filter((candidate) => !taken.has(candidate)).slice(0, 5) }
    } catch (error) {
        console.error('Error building username suggestions:', error)
        return { suggestions: [] }
    }
}

type CommitResult =
    | {
          success: true
          step: number
          committedThrough: number
          version: number
          draft: OnboardingDraft
      }
    | (FailedResult & {
          step?: number
          committedThrough?: number
          version?: number
          draft?: OnboardingDraft
      })

const draftColumns = { step: true, completedThrough: true, version: true, draft: true } as const

export async function commitOnboardingStep(input: {
    step: number
    draft: unknown
    expectedVersion: number
    telemetry?: OnboardingEventInput[]
}): Promise<CommitResult> {
    try {
        const { user, ipAddress, userAgent } = await getViewer()
        if (!user) return failed(onboardingError('NOT_AUTHENTICATED', 'Session expired. Sign in again.'))
        if (!isEmailVerified(user as unknown as Record<string, unknown>)) {
            return failed(onboardingError('INVALID_INPUT', 'Verify your email to continue.'))
        }

        const currentStep = clampOnboardingStep(input.step)
        if (currentStep >= ONBOARDING_TOTAL_STEPS) {
            return failed(onboardingError('INVALID_INPUT', 'Complete the final step to finish profile setup.'))
        }

        const draft = parseOnboardingDraft(input.draft)
        if (currentStep === 1) {
            // The raw value is judged, not a cleaned-up copy: a name with a space or symbol is refused, not silently changed.
            const username = normalizeUsername(draft.username ?? '')
            const usernameValidation = validateUsername(username)
            if (!usernameValidation.valid) {
                return failed(onboardingError('USERNAME_INVALID', usernameValidation.message))
            }
            if ((draft.fullName ?? '').length < 2) {
                return failed(onboardingError('INVALID_INPUT', 'Enter your full name (at least 2 characters).'))
            }
            const budget = await consumeUsernameCheckBudget({ viewerKey: user.id, viewerId: user.id, ipAddress, userAgent })
            if (!budget.allowed) {
                return failed(onboardingError('RATE_LIMITED', 'Too many checks. Wait and try again.', true))
            }
            const availability = await ensureUsernameIsAvailable({ username, userId: user.id })
            if (!availability.ok) return failed(availability.error)
            draft.username = username
        }
        if (currentStep === 3 && (!draft.skills || draft.skills.length === 0)) {
            return failed(onboardingError('INVALID_INPUT', 'Select at least one skill to continue.'))
        }

        const profileShell = await ensureOnboardingProfileShell({
            userId: user.id,
            userEmail: user.email,
            metadata: user.user_metadata,
        })
        if (!profileShell.success) return failed(profileShell.error)

        const telemetry = sanitizeOnboardingTelemetryBatch(input.telemetry)
        const nextStep = Math.min(ONBOARDING_TOTAL_STEPS, currentStep + 1)
        const now = new Date()
        const expiresAt = new Date(now.getTime() + ONBOARDING_SERVER_DRAFT_TTL_MS)

        const rows = await db.transaction(async (tx) => {
            const saved = await tx
                .insert(onboardingDrafts)
                .values({
                    userId: user.id,
                    step: nextStep,
                    completedThrough: currentStep,
                    version: 1,
                    schemaVersion: ONBOARDING_SCHEMA_VERSION,
                    draft,
                    expiresAt,
                    updatedAt: now,
                })
                .onConflictDoUpdate({
                    target: onboardingDrafts.userId,
                    set: {
                        // Revisiting an earlier step from the review never moves the resume point backwards.
                        step: sql`GREATEST(${onboardingDrafts.step}, ${nextStep})`,
                        completedThrough: sql`GREATEST(${onboardingDrafts.completedThrough}, ${currentStep})`,
                        version: sql`${onboardingDrafts.version} + 1`,
                        schemaVersion: ONBOARDING_SCHEMA_VERSION,
                        draft,
                        expiresAt,
                        updatedAt: now,
                    },
                    // A step can only be saved once the one before it has been: no skipping ahead.
                    where: and(
                        eq(onboardingDrafts.version, input.expectedVersion),
                        sql`${onboardingDrafts.completedThrough} >= ${currentStep - 1}`,
                    ),
                })
                .returning({
                    step: onboardingDrafts.step,
                    completedThrough: onboardingDrafts.completedThrough,
                    version: onboardingDrafts.version,
                    draft: onboardingDrafts.draft,
                })

            if (saved.length > 0) {
                // Marks the account in progress once; later saves leave the indexed row alone.
                await tx
                    .update(profiles)
                    .set({ onboardingStatus: 'in_progress', onboardingVersion: ONBOARDING_SCHEMA_VERSION, updatedAt: now })
                    .where(and(eq(profiles.id, user.id), sql`${profiles.onboardingStatus} NOT IN ('in_progress', 'completed')`))
                await writeEvents(tx, user.id, telemetry)
            }
            return saved
        })

        const saved = rows[0]
        if (saved) {
            return {
                success: true,
                step: clampOnboardingStep(saved.step),
                committedThrough: clampCompletedThrough(saved.completedThrough),
                version: saved.version,
                draft: parseOnboardingDraft(saved.draft),
            }
        }

        const latest = await db.query.onboardingDrafts.findFirst({
            where: eq(onboardingDrafts.userId, user.id),
            columns: draftColumns,
        })
        const latestDraft = latest ? parseOnboardingDraft(latest.draft) : undefined

        // The save landed but its response was lost: the retry finds exactly what it was about to write.
        if (
            latest &&
            latestDraft &&
            latest.version === input.expectedVersion + 1 &&
            latest.step === nextStep &&
            JSON.stringify(latestDraft) === JSON.stringify(draft)
        ) {
            return {
                success: true,
                step: clampOnboardingStep(latest.step),
                committedThrough: clampCompletedThrough(latest.completedThrough),
                version: latest.version,
                draft: latestDraft,
            }
        }

        return {
            ...failed(
                onboardingError('DRAFT_CONFLICT', 'This profile setup draft changed in another tab. The latest version is ready to review.'),
            ),
            step: latest ? clampOnboardingStep(latest.step) : currentStep,
            committedThrough: latest ? clampCompletedThrough(latest.completedThrough) : undefined,
            version: latest?.version,
            draft: latestDraft,
        }
    } catch (error) {
        console.error('Error committing onboarding step:', error)
        return failed(
            onboardingError('DB_ERROR', 'Couldn’t save this step right now. Your entries are still available in this browser.', true),
        )
    }
}
