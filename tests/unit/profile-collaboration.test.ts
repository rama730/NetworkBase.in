import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeProfile } from '@/lib/utils/normalize-profile'
import { applyOptimisticUpdate, applyPayloadToFormBase, toFormState, toServerPayload, toChangedServerPayload } from '@/lib/profile/normalization'
import { profileUpdateSchema } from '@/lib/validations/profile'

test('availability is explicit, preserves false, and never follows role preferences', () => {
  const profile = { open_to_collaborate: false, open_to: ['Contract roles'], hours_per_week: 'h_10_20', connections_count: 2 }
  assert.equal(normalizeProfile(profile)?.openToCollaborate, false)
  assert.equal(normalizeProfile(profile)?.connectionsCount, 2)
  assert.equal(normalizeProfile({ openTo: ['Contract roles'] })?.openToCollaborate, false)
  const form = toFormState(profile)
  assert.equal(form.openToCollaborate, false)
  const enabled = applyPayloadToFormBase(form, { openToCollaborate: true })
  assert.equal(enabled.openToCollaborate, true)
  const paused = applyPayloadToFormBase(enabled, { openToCollaborate: false })
  assert.equal(paused.openToCollaborate, false)
  assert.equal(toServerPayload(paused).openToCollaborate, false)
  assert.deepEqual(paused.openTo, ['Contract roles'])
  assert.equal(applyOptimisticUpdate({ openToCollaborate: true }, { openToCollaborate: false }).openToCollaborate, false)
})

test('availability update accepts booleans only, including a standalone pause', () => {
  assert.deepEqual(profileUpdateSchema.parse({ openToCollaborate: false }), { openToCollaborate: false })
  assert.equal(profileUpdateSchema.safeParse({ openToCollaborate: 'false' }).success, false)
})


test('a draft save changes availability without overwriting untouched roles or capacity', () => {
  const base = toFormState({openToCollaborate:true,openTo:['Contract roles'],hoursPerWeek:'h_10_20'});
  const patch = toChangedServerPayload({...base,openToCollaborate:false},base,'2026-10-13T12:00:00.000Z');
  assert.deepEqual(patch,{openToCollaborate:false,expectedUpdatedAt:'2026-10-13T12:00:00.000Z'});
});
