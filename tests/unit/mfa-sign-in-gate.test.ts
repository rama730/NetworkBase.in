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

test('one gate covers every server read, and pages lead to the code step', () => {
    const server = readFileSync('src/lib/supabase/server.ts', 'utf8')
    const middleware = readFileSync('src/lib/supabase/middleware.ts', 'utf8')
    const proxy = readFileSync('src/proxy.ts', 'utf8')
    const gate = readFileSync('src/lib/auth/mfa-gate.ts', 'utf8')
    const login = readFileSync('src/components/auth/LoginForm.tsx', 'utf8')
    // Pages, server actions and API routes all resolve the viewer through this one snapshot.
    assert.match(server, /resolveAuthSnapshot\(client\)\.then\(withSecondFactorGate\)/)
    assert.match(server, /return \{ \.\.\.resolution, session: null, snapshot: null, user: null \}/)
    assert.match(middleware, /if \(user && await isSecondFactorDue\(user\.id, userAal\)\)/)
    assert.match(middleware, /codeStepUrl\.searchParams\.set\('step', 'mfa'\)/)
    assert.match(proxy, /"\/legal\/accept"\]\)/)
    // The factor list comes from the database, never the unsigned cookie copy of the user.
    // auth.mfa_factors is read through app_private (0268); the function checks status = 'verified'.
    assert.match(gate, /app_private\.nb_user_has_verified_mfa\(\$\{userId\}::uuid\)/)
    assert.match(gate, /return cached\?\.has \?\? false/)
    // A cached "no factor" must expire within seconds, or a fresh enrolment leaves a password-only window.
    assert.match(gate, /const NO_FACTOR_TTL_MS = 5_000;/)
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
