import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding/contracts'

export const ONBOARDING_SCHEMA_VERSION = 3
export const ONBOARDING_LOCAL_DRAFT_TTL_MS = 24 * 60 * 60 * 1000
export const ONBOARDING_SERVER_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type OnboardingStatus = 'not_started' | 'in_progress' | 'completed'

export function clampOnboardingStep(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 1
    return Math.min(ONBOARDING_TOTAL_STEPS, Math.max(1, Math.floor(value)))
}

export function clampCompletedThrough(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0
    return Math.min(ONBOARDING_TOTAL_STEPS, Math.max(0, Math.floor(value)))
}

export function onboardingStorageKeys(userId: string) {
    return { draft: `onboarding:${userId.trim()}:draft:v${ONBOARDING_SCHEMA_VERSION}` }
}

export function isCompletedOnboardingStatus(value: unknown): boolean {
    return value === 'completed'
}

type OnboardingClaimsUser = {
    app_metadata?: Record<string, unknown> | null
}

/**
 * AUTH-012: only app_metadata, which the browser cannot write, can prove completion.
 * user_metadata (username, onboarding_status) is display input the user edits freely.
 */
export function hasOnboardingClaims(user: OnboardingClaimsUser) {
    return user.app_metadata?.onboarding_complete === true
}
