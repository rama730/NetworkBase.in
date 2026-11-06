import test from 'node:test'
import assert from 'node:assert/strict'

import { orgStatusTone, sprintStatusLabel, visibilityLabel, withCount } from '../../src/lib/organizations/display'

test('states take the tone of their meaning, not of another state', () => {
    assert.equal(orgStatusTone('archived'), 'neutral')
    assert.equal(orgStatusTone('private'), 'neutral')
    assert.equal(orgStatusTone('submitted'), 'warning')
    assert.equal(orgStatusTone('returned'), 'danger')
    assert.equal(orgStatusTone('active'), 'info')
    assert.equal(orgStatusTone('approved'), 'success')
    assert.equal(orgStatusTone('something-new'), 'neutral')
})

test('sprint status words follow the organization spec', () => {
    assert.equal(sprintStatusLabel('planning'), 'Upcoming')
    assert.equal(sprintStatusLabel('active'), 'Active')
    assert.equal(sprintStatusLabel('running'), 'Active')
    assert.equal(sprintStatusLabel('ended'), 'Completed')
    assert.equal(sprintStatusLabel('completed'), 'Completed')
    assert.equal(sprintStatusLabel('cancelled'), 'Cancelled')
})

test('one set of visibility words', () => {
    assert.equal(visibilityLabel('org'), 'Organization only')
    assert.equal(visibilityLabel('members_only'), 'Organization only')
    assert.equal(visibilityLabel('private'), 'Private')
    assert.equal(visibilityLabel('public'), 'Public')
    assert.equal(withCount('Requests', 3), 'Requests · 3')
})
