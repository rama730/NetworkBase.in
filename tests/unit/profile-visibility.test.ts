import test from 'node:test'
import assert from 'node:assert/strict'
import { buildViewerScopedProfileView } from '@/lib/privacy/profile-views'
import { derivePrivacyRelationshipState } from '@/lib/privacy/relationship-state'

test('viewer-scoped profile view strips non-display profile fields', () => {
    const relationship = derivePrivacyRelationshipState({
        viewerId: 'viewer-1',
        targetUserId: 'profile-1',
        profileVisibility: 'public',
    })
    const view = buildViewerScopedProfileView({
        relationship,
        profile: {
            id: 'profile-1',
            email: 'private@example.com',
            username: 'builder',
            fullName: 'Builder One',
            notificationPreferences: { messages: true },
            workspaceLayout: { version: 1, widgets: [] },
            workspaceInboxCount: 9,
            availabilityStatus: 'available',
            bio: 'Public bio',
            openTo: ['Full-time roles'],
            experienceLevel: 'senior',
            hoursPerWeek: 'h_10_20',
            visibility: 'public',
            messagePrivacy: 'connections',
            connectionPrivacy: 'everyone',
        },
    }) as Record<string, unknown>

    assert.equal(view.email, undefined)
    assert.equal(view.notificationPreferences, undefined)
    assert.equal(view.workspaceLayout, undefined)
    assert.equal(view.workspaceInboxCount, undefined)
    assert.equal(view.availabilityStatus, undefined)
    assert.equal(view.bio, 'Public bio')
    assert.deepEqual(view.openTo, ['Full-time roles'])
    assert.equal(view.experienceLevel, 'senior')
    assert.equal(view.hoursPerWeek, 'h_10_20')
})

test('viewer-scoped locked profile keeps only limited identity fields', () => {
    const relationship = derivePrivacyRelationshipState({
        viewerId: 'viewer-1',
        targetUserId: 'profile-1',
        profileVisibility: 'private',
    })
    const view = buildViewerScopedProfileView({
        relationship,
        profile: {
            id: 'profile-1',
            email: 'private@example.com',
            username: 'builder',
            fullName: 'Builder One',
            bio: 'Private bio',
            website: 'https://example.com',
            socialLinks: { github: 'https://github.com/example' },
            skills: ['React'],
            openTo: ['Full-time roles'],
            experienceLevel: 'senior',
            hoursPerWeek: 'h_10_20',
            visibility: 'private',
            messagePrivacy: 'connections',
            connectionPrivacy: 'everyone',
        },
    }) as Record<string, unknown>

    assert.equal(view.email, undefined)
    assert.equal(view.username, 'builder')
    assert.equal(view.bio, null)
    assert.deepEqual(view.socialLinks, {})
    assert.deepEqual(view.skills, [])
    assert.deepEqual(view.openTo, [])
    assert.equal(view.experienceLevel, null)
    assert.equal(view.hoursPerWeek, null)
    assert.equal(view.messagePrivacy, null)
})
