import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
    ONBOARDING_SCHEMA_VERSION,
    clampCompletedThrough,
    clampOnboardingStep,
    isCompletedOnboardingStatus,
    onboardingStorageKeys,
} from '@/lib/onboarding/state'

describe('onboarding state contract', () => {
    it('scopes browser persistence to the authenticated user', () => {
        const first = onboardingStorageKeys('user-a')
        const second = onboardingStorageKeys('user-b')
        assert.notEqual(first.draft, second.draft)
        assert.match(first.draft, new RegExp(`user-a:.*v${ONBOARDING_SCHEMA_VERSION}$`))
    })

    it('clamps persisted progress to the four-step contract', () => {
        assert.equal(clampOnboardingStep(-10), 1)
        assert.equal(clampOnboardingStep(99), 4)
        assert.equal(clampCompletedThrough(-1), 0)
        assert.equal(clampCompletedThrough(9), 4)
    })

    it('only the recorded status completes onboarding, never a username alone', () => {
        assert.equal(isCompletedOnboardingStatus('completed'), true)
        assert.equal(isCompletedOnboardingStatus('in_progress'), false)
        assert.equal(isCompletedOnboardingStatus(undefined), false)
    })
})
