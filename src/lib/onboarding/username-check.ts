import { consumeRateLimit } from '@/lib/security/rate-limit'
import { onboardingError, type OnboardingError } from '@/lib/onboarding/errors'
import { logger } from '@/lib/logger'
import { getUsernameAvailability } from '@/lib/usernames/service'
import { normalizeUsername } from '@/lib/validations/username'
import { positiveIntegerOr } from '@/lib/utils/number'

export type UsernameAvailabilityResult = {
    available: boolean
    message: string
    code?: OnboardingError['code']
    rateLimited?: boolean
    error?: OnboardingError
}

function rateConfig() {
    return {
        limit: positiveIntegerOr(process.env.ONBOARDING_USERNAME_CHECK_LIMIT, 30),
        windowSeconds: positiveIntegerOr(process.env.ONBOARDING_USERNAME_CHECK_WINDOW_SECONDS, 60),
        ipLimit: positiveIntegerOr(process.env.ONBOARDING_USERNAME_CHECK_IP_LIMIT, 80),
        fingerprintLimit: positiveIntegerOr(process.env.ONBOARDING_USERNAME_CHECK_FINGERPRINT_LIMIT, 50),
        // SEC-H2: anonymous users get a much tighter daily enumeration cap so a
        // patient attacker cannot chew through tens of thousands of usernames
        // over a 24 h window by staying within the per-minute limits.
        anonDailyLimit: positiveIntegerOr(process.env.ONBOARDING_USERNAME_CHECK_ANON_DAILY_LIMIT, 500),
        anonDailyWindowSeconds: positiveIntegerOr(
            process.env.ONBOARDING_USERNAME_CHECK_ANON_DAILY_WINDOW_SECONDS,
            24 * 60 * 60,
        ),
    }
}

// No per-username key: it was shared by everyone, so one person could keep a name returning 429 for all.
export function buildOnboardingRateLimitKeys(params: {
    viewerKey: string
    ipAddress?: string | null
    userAgent?: string | null
}) {
    const ip = (params.ipAddress || 'unknown').trim() || 'unknown'
    const ua = (params.userAgent || 'unknown').trim().toLowerCase().slice(0, 120) || 'unknown'
    return {
        user: `onboarding:username-check:user:${params.viewerKey}`,
        ip: `onboarding:username-check:ip:${ip}`,
        fingerprint: `onboarding:username-check:fingerprint:${ip}:${ua}`,
        anonDaily: `onboarding:username-check:anon-daily:${ip}`,
    }
}

/**
 * The one budget every "is this name taken?" answer spends: the check API, the step 1 save and the
 * suggestions. Anything that reveals availability must call this first.
 */
export async function consumeUsernameCheckBudget(params: {
    viewerKey: string
    viewerId?: string | null
    ipAddress?: string | null
    userAgent?: string | null
}): Promise<{ allowed: boolean }> {
    const config = rateConfig()
    const keys = buildOnboardingRateLimitKeys(params)
    const results = await Promise.all([
        consumeRateLimit(keys.user, config.limit, config.windowSeconds),
        consumeRateLimit(keys.ip, config.ipLimit, config.windowSeconds),
        consumeRateLimit(keys.fingerprint, config.fingerprintLimit, config.windowSeconds),
        params.viewerId
            ? Promise.resolve({ allowed: true } as const)
            : consumeRateLimit(keys.anonDaily, config.anonDailyLimit, config.anonDailyWindowSeconds),
    ])
    const allowed = results.every((result) => result.allowed)
    if (!allowed) {
        logger.metric('username.availability.rate_limited', {
            viewerKey: params.viewerKey,
            allowed: results.map((result) => result.allowed),
        })
    }
    return { allowed }
}

export const USERNAME_CHECK_LIMITED = onboardingError(
    'RATE_LIMITED',
    'Too many checks. Wait and try again.',
    true,
)

export async function checkUsernameAvailability(params: {
    username: string
    viewerKey: string
    viewerId?: string | null
    ipAddress?: string | null
    userAgent?: string | null
}): Promise<UsernameAvailabilityResult> {
    const budget = await consumeUsernameCheckBudget(params)
    if (!budget.allowed) {
        return {
            available: false,
            message: USERNAME_CHECK_LIMITED.message,
            code: USERNAME_CHECK_LIMITED.code,
            error: USERNAME_CHECK_LIMITED,
            rateLimited: true,
        }
    }

    try {
        const result = await getUsernameAvailability({
            username: params.username,
            viewerId: params.viewerId,
        })
        return { available: result.available, message: result.message, code: result.code, error: result.error }
    } catch (queryError) {
        console.error('Error checking username availability:', {
            username: normalizeUsername(params.username),
            error: queryError,
        })
        const error = onboardingError('DB_ERROR', 'Error checking availability', true)
        return { available: false, message: error.message, code: error.code, error }
    }
}
