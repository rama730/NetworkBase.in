import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeAuthNextPath } from '@/lib/auth/redirects'

// The legal-acceptance page used to check only for a leading "/" and no "//". A backslash gets past that,
// and browsers read "/\evil.com" as "//evil.com". It now uses the shared normalizer.
test('the shared normalizer refuses every open-redirect shape the old check let through', () => {
    for (const value of ['/\\evil.com', '/\\/evil.com', '//evil.com', 'https://evil.com', 'javascript:alert(1)', '/auth/callback?next=x']) {
        assert.equal(normalizeAuthNextPath(value), '/discover', value)
    }
    assert.equal(normalizeAuthNextPath('/workspaces/abc?tab=files'), '/workspaces/abc?tab=files')
})

test('the legal acceptance page navigates only through the shared normalizer', () => {
    const source = readFileSync('src/app/(site)/legal/accept/page.tsx', 'utf8')
    assert.match(source, /router\.replace\(normalizeAuthNextPath\(/)
    assert.doesNotMatch(source, /startsWith\("\/"\)/)
})
