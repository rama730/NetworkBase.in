import test from 'node:test'
import assert from 'node:assert/strict'
import { buildViewerScopedProfileView } from '@/lib/privacy/profile-views'
import { toChangedServerPayload, toFormState, toServerPayload } from '@/lib/profile/normalization'

const row = { id: 'u1', username: 'ada', fullName: 'Ada', genderIdentity: 'female', pronouns: 'she/her', interests: ['Startups'], visibility: 'public' }
const allowed = { canViewProfile: true, blockedByTarget: false, blockedByViewer: false } as never

test('gender and pronouns reach the owner and nobody else', () => {
    assert.equal(buildViewerScopedProfileView({ profile: row, relationship: allowed, isOwner: true })?.genderIdentity, 'female')
    assert.equal(buildViewerScopedProfileView({ profile: row, relationship: allowed, isOwner: true })?.pronouns, 'she/her')
    for (const isOwner of [false, undefined]) {
        const view = buildViewerScopedProfileView({ profile: row, relationship: allowed, isOwner })
        assert.equal(view?.genderIdentity, null)
        assert.equal(view?.pronouns, null)
    }
})

test('the edit form carries gender, pronouns and interests both ways', () => {
    const form = toFormState({ gender_identity: 'non_binary', pronouns: ' they/them ', interests: ['AI/ML'] })
    assert.equal(form.genderIdentity, 'non_binary')
    assert.deepEqual(form.interests, ['AI/ML'])

    const payload = toServerPayload({ ...form, pronouns: ' they/them ' })
    assert.equal(payload.genderIdentity, 'non_binary')
    assert.equal(payload.pronouns, 'they/them')

    const cleared = toServerPayload({ ...form, genderIdentity: '', pronouns: '   ' })
    assert.equal(cleared.genderIdentity, null, 'cleared means null, not an empty string the database would refuse')
    assert.equal(cleared.pronouns, null)
})

test('only edited personal details are sent', () => {
    const base = toFormState(row)
    assert.deepEqual(
        Object.keys(toChangedServerPayload({ ...base, pronouns: 'she/they' }, base, '2026-01-01T00:00:00.000Z')).sort(),
        ['expectedUpdatedAt', 'pronouns'],
    )
    assert.deepEqual(
        Object.keys(toChangedServerPayload({ ...base, interests: [...base.interests, 'DevOps'] }, base, '2026-01-01T00:00:00.000Z')).sort(),
        ['expectedUpdatedAt', 'interests'],
    )
})
