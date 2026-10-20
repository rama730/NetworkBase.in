import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOnboardingRateLimitKeys } from '@/lib/onboarding/username-check'

test('buildOnboardingRateLimitKeys composes deterministic keys with no shared per-name key', () => {
    const keys = buildOnboardingRateLimitKeys({
        viewerKey: 'user-1',
        ipAddress: '203.0.113.10',
        userAgent: 'Mozilla/5.0 Test',
    })

    assert.equal(keys.user, 'onboarding:username-check:user:user-1')
    assert.equal(keys.ip, 'onboarding:username-check:ip:203.0.113.10')
    assert.equal(keys.fingerprint, 'onboarding:username-check:fingerprint:203.0.113.10:mozilla/5.0 test')
    assert.equal(keys.anonDaily, 'onboarding:username-check:anon-daily:203.0.113.10')
    assert.equal('target' in keys, false)
})
