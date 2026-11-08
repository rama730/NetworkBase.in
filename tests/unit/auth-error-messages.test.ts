import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveAuthPageErrorMessage } from '@/lib/auth/error-messages'

describe('auth error messages', () => {
    it('says which way in failed, never a developer hint or the wrong provider (A1)', () => {
        assert.match(resolveAuthPageErrorMessage('google-failed') || '', /^Google sign-in didn’t finish/)
        assert.match(resolveAuthPageErrorMessage('github-failed') || '', /^GitHub sign-in didn’t finish/)
        assert.match(resolveAuthPageErrorMessage('reset-link-expired') || '', /code that works on any device/)
        assert.match(resolveAuthPageErrorMessage('link-expired') || '', /Ask for a new code/)
        for (const code of ['auth-code-error', 'google-failed', 'github-failed', 'link-expired', 'reset-link-expired', 'security-check']) {
            assert.doesNotMatch(resolveAuthPageErrorMessage(code) || '', /developing locally|same origin/i, code)
        }
        assert.doesNotMatch(resolveAuthPageErrorMessage('auth-code-error') || '', /Google/)
    })

    it('returns null for unknown auth page error codes', () => {
        assert.equal(resolveAuthPageErrorMessage('unexpected-error'), null)
        assert.equal(resolveAuthPageErrorMessage(null), null)
    })
})
