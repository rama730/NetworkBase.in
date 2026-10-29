import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DESIGNATED_CATEGORIES,
  ROLE_PREFERENCE_OPTIONS,
  canonicalRolePreference,
  getRolePreferences,
  replaceRolePreferences,
  rolePreferenceLabel,
  weeklyCapacityLabel,
} from '@/lib/profile/role-preferences'

test('role preferences normalize legacy aliases into stable display order', () => {
  assert.deepEqual(
    getRolePreferences(['freelance', 'Full-time roles', 'cofounder', 'freelance']),
    ['Full-time roles', 'Freelance projects', 'Co-founder opportunities'],
  )
  assert.equal(rolePreferenceLabel('contract'), 'Contract')
  assert.equal(weeklyCapacityLabel('h_10_20'), '10–20 hours a week')
})

test('updating roles retains unrelated legacy collaboration interests', () => {
  assert.deepEqual(
    replaceRolePreferences(
      ['Mentorship', 'Open source collaboration', 'Full-time roles'],
      ['Part-time roles'],
    ),
    ['Mentorship', 'Open source collaboration', 'Part-time roles'],
  )
})

test('role preference options and labels cover all 12 engagement models', () => {
  assert.equal(ROLE_PREFERENCE_OPTIONS.length, 12)
  for (const option of ROLE_PREFERENCE_OPTIONS) {
    assert.equal(typeof option.value, 'string')
    assert.equal(typeof option.label, 'string')
    assert.equal(rolePreferenceLabel(option.value), option.label)
  }
})

test('designated categories list contains curated disciplines', () => {
  assert.ok(DESIGNATED_CATEGORIES.length >= 16)
  assert.ok(DESIGNATED_CATEGORIES.includes('Engineering'))
  assert.ok(DESIGNATED_CATEGORIES.includes('Design'))
  assert.ok(DESIGNATED_CATEGORIES.includes('Product'))
  assert.ok(DESIGNATED_CATEGORIES.includes('Growth'))
  assert.ok(DESIGNATED_CATEGORIES.includes('AI and Machine Learning'))
  assert.ok(DESIGNATED_CATEGORIES.includes('Data and Analytics'))
  assert.ok(DESIGNATED_CATEGORIES.includes('Security and DevOps'))
})

test('role aliases normalize extended role types', () => {
  assert.equal(canonicalRolePreference('advisor'), 'Advisory roles')
  assert.equal(canonicalRolePreference('consultant'), 'Consulting projects')
  assert.equal(canonicalRolePreference('fractional'), 'Fractional leadership')
  assert.equal(canonicalRolePreference('board member'), 'Board member roles')
  assert.equal(canonicalRolePreference('volunteer'), 'Volunteer / Pro bono')
  assert.equal(canonicalRolePreference('pro bono'), 'Volunteer / Pro bono')
  assert.equal(canonicalRolePreference('temporary'), 'Temporary / Seasonal')
})

