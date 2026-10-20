import test from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_ONBOARDING_DATA, applyDraft, toDraftPayload, toggleIn } from '@/lib/onboarding/form-data'
import { parseOnboardingDraft } from '@/lib/validations/onboarding'

test('applyDraft keeps current values for anything the draft does not carry', () => {
    const base = { ...EMPTY_ONBOARDING_DATA, fullName: 'From account', socialLinks: { ...EMPTY_ONBOARDING_DATA.socialLinks, x: 'x.com/me' } }
    const next = applyDraft(base, parseOnboardingDraft({ username: 'ada', socialLinks: { github: 'github.com/ada' }, visibility: 'private' }))
    assert.equal(next.fullName, 'From account')
    assert.equal(next.username, 'ada')
    assert.equal(next.visibility, 'private')
    assert.deepEqual(next.socialLinks, { github: 'github.com/ada', linkedin: '', x: 'x.com/me', portfolio: '' })
})

test('a local photo preview is never sent, and unset choices are omitted', () => {
    const payload = toDraftPayload({ ...EMPTY_ONBOARDING_DATA, avatarUrl: 'blob:http://localhost/abc', pronouns: '   ' })
    assert.equal(payload.avatarUrl, '')
    assert.equal(payload.pronouns, undefined)
    assert.equal(payload.experienceLevel, undefined)
    assert.equal(toDraftPayload({ ...EMPTY_ONBOARDING_DATA, avatarUrl: 'https://cdn.example.com/a.jpg' }).avatarUrl, 'https://cdn.example.com/a.jpg')
})

test('toggleIn adds then removes', () => {
    assert.deepEqual(toggleIn(['a'], 'b'), ['a', 'b'])
    assert.deepEqual(toggleIn(['a', 'b'], 'a'), ['b'])
})
