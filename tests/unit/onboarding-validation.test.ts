import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOnboardingPayload, parseOnboardingDraft } from '@/lib/validations/onboarding'

const base = { username: 'builder_42', fullName: 'Builder User', visibility: 'public' as const }

test('normalizeOnboardingPayload sanitizes optional fields and dedupes tags', () => {
    const payload = normalizeOnboardingPayload({
        username: 'Builder_42',
        fullName: '  Builder User  ',
        headline: '  Full stack developer  ',
        bio: '  Building useful products.  ',
        location: '  San Francisco  ',
        website: 'https://example.com',
        skills: ['React', 'react', 'TypeScript'],
        interests: ['AI', 'ai', 'Open source'],
        openTo: ['Freelance', 'freelance', 'Mentorship'],
        socialLinks: { github: 'github.com/builder', portfolio: 'https://builder.dev' },
        pronouns: '  they/them  ',
        visibility: 'public',
    })

    assert.equal(payload.username, 'builder_42')
    assert.equal(payload.fullName, 'Builder User')
    assert.deepEqual(payload.skills, ['React', 'TypeScript'])
    assert.deepEqual(payload.interests, ['AI', 'Open source'])
    assert.deepEqual(payload.openTo, ['Freelance projects'])
    assert.equal(payload.pronouns, 'they/them')
})

test('social links are stored in the ordered list profile edit writes', () => {
    const payload = normalizeOnboardingPayload({
        ...base,
        socialLinks: { github: 'github.com/builder', portfolio: 'https://builder.dev', x: '' },
    })
    assert.ok(Array.isArray(payload.socialLinks))
    assert.deepEqual(payload.socialLinks.map((link) => link.platform), ['github', 'portfolio'])
    assert.equal(payload.socialLinks[0]!.url, 'https://github.com/builder')
})

test('a social link that is not a public web address is rejected, not stored', () => {
    assert.throws(() => normalizeOnboardingPayload({ ...base, socialLinks: { github: 'javascript:alert(1)' } }))
    assert.throws(() => normalizeOnboardingPayload({ ...base, socialLinks: { github: 'http://localhost/x' } }))
})

test('normalizeOnboardingPayload rejects invalid website protocol', () => {
    assert.throws(() => normalizeOnboardingPayload({ ...base, website: 'javascript:alert(1)' }))
})

test('the website limit applies to the stored value, after https:// is added', () => {
    const host = `${'a'.repeat(185)}.com`
    assert.equal(normalizeOnboardingPayload({ ...base, website: `https://${host.slice(0, 190)}.io` }).website?.length, 200)
    // 194 typed characters become 202 once https:// is added
    assert.throws(() => normalizeOnboardingPayload({ ...base, website: `${'b'.repeat(190)}.com` }), /200 characters/)
})

test('avatar must be a safe http(s) URL: data and blob URLs are refused', () => {
    assert.throws(() => normalizeOnboardingPayload({ ...base, avatarUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }))
    assert.throws(() => normalizeOnboardingPayload({ ...base, avatarUrl: 'blob:http://localhost/abc' }))
    assert.equal(normalizeOnboardingPayload({ ...base, avatarUrl: 'https://cdn.example.com/a.jpg' }).avatarUrl, 'https://cdn.example.com/a.jpg')
})

test('limits match the database checks', () => {
    assert.throws(() => normalizeOnboardingPayload({ ...base, headline: 'h'.repeat(121) }))
    assert.throws(() => normalizeOnboardingPayload({ ...base, bio: 'b'.repeat(501) }))
    assert.throws(() => normalizeOnboardingPayload({ ...base, location: 'l'.repeat(121) }))
    assert.throws(() => normalizeOnboardingPayload({ ...base, fullName: 'n'.repeat(81) }))
    assert.doesNotThrow(() => normalizeOnboardingPayload({ ...base, headline: 'h'.repeat(120), bio: 'b'.repeat(500) }))
})

test('parseOnboardingDraft keeps what it can and never throws', () => {
    const draft = parseOnboardingDraft({
        username: '  Some_One ',
        fullName: 'f'.repeat(200),
        avatarUrl: 'blob:http://localhost/x',
        skills: ['React', 'react', 7, 'x'.repeat(50)],
        visibility: 'everyone',
        messagePrivacy: 'everyone',
        socialLinks: { github: ' github.com/a ', bogus: 'x' },
        website: 'not a url yet',
    })
    assert.equal(draft.username, 'some_one')
    assert.equal(draft.fullName?.length, 80)
    assert.equal(draft.avatarUrl, undefined)
    assert.deepEqual(draft.skills, ['React', 'x'.repeat(32)])
    assert.equal(draft.visibility, undefined)
    assert.equal(draft.messagePrivacy, 'everyone')
    assert.deepEqual(draft.socialLinks, { github: 'github.com/a' })
    assert.equal(draft.website, 'not a url yet')
    assert.deepEqual(parseOnboardingDraft(null), parseOnboardingDraft({}))
})
