import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { needsSecondFactor } from '@/lib/auth/mfa-ui'

test('a password-only session with a verified factor must finish the second step', () => {
    assert.equal(needsSecondFactor('aal1', true), true)
    assert.equal(needsSecondFactor(null, true), true)
    assert.equal(needsSecondFactor('aal2', true), false)
    assert.equal(needsSecondFactor('aal1', false), false)
})

test('the main layout sends unfinished sessions to the code step, and /login lets them through', () => {
    const layout = readFileSync('src/app/(site)/(main)/layout.tsx', 'utf8')
    const middleware = readFileSync('src/lib/supabase/middleware.ts', 'utf8')
    const login = readFileSync('src/components/auth/LoginForm.tsx', 'utf8')
    assert.match(layout, /hasVerifiedMfaFactor\(user\.id\)/)
    assert.match(layout, /redirect\(`\/login\?step=mfa&redirect=/)
    assert.match(middleware, /searchParams\.get\('step'\) === 'mfa'/)
    assert.match(login, /mfa\.challengeAndVerify\(\{ factorId: factor\.id, code: value \}\)/)
    assert.match(login, /syncBrowserSessionToServer\(data\.session\)/)
})

test('provider errors people can act on read as plain copy', async () => {
    const { toFriendlyAuthError } = await import('@/lib/auth/error-messages')
    assert.match(toFriendlyAuthError('captcha protection: request disallowed (no captcha_token found)', 'x'), /security check/)
    assert.match(toFriendlyAuthError('email rate limit exceeded', 'x'), /Too many attempts/)
    assert.equal(toFriendlyAuthError('Invalid login credentials', 'x'), 'Invalid login credentials')
    assert.equal(toFriendlyAuthError('', 'fallback'), 'fallback')
})
