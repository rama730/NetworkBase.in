import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveProfileActionState } from '../../src/components/profile/v2/profile-action-state'

const base = {
  isAuthenticated: true,
  canSendMessage: false,
  canSendConnectionRequest: true,
  blockedByViewer: false,
  blockedByTarget: false,
  canManageBlock: true,
  hasSecondaryHandler: true,
} as const

test('connected profiles use neutral relationship styling and expose permitted messaging', () => {
  const state = resolveProfileActionState({
    ...base,
    connectionState: 'accepted',
    canSendMessage: true,
  })

  assert.equal(state.relationshipControlLabel, 'Connected')
  assert.equal(state.relationshipControlVariant, 'outline')
  assert.equal(state.hasSecondaryConnectionAction, true)
  assert.equal(state.showRelationshipAction, true)
  assert.equal(state.showMessageAction, true)
})

test('disconnected profiles hide unavailable messaging and keep overflow inside Connect', () => {
  const state = resolveProfileActionState({
    ...base,
    connectionState: 'none',
  })

  assert.equal(state.relationshipControlLabel, 'Connect')
  assert.equal(state.relationshipControlVariant, 'default')
  assert.equal(state.isPrimaryConnectionAction, true)
  assert.equal(state.showRelationshipAction, true)
  assert.equal(state.showMessageAction, false)
})

test('incoming requests provide both accept and decline through the relationship menu', () => {
  const state = resolveProfileActionState({
    ...base,
    connectionState: 'pending_incoming',
  })

  assert.equal(state.relationshipControlLabel, 'Accept')
  assert.equal(state.relationshipControlVariant, 'default')
  assert.equal(state.isPrimaryConnectionAction, true)
  assert.equal(state.hasSecondaryConnectionAction, true)
})

test('blocked and signed-out profiles never render interactive relationship controls', () => {
  const blocked = resolveProfileActionState({
    ...base,
    connectionState: 'accepted',
    canSendMessage: true,
    blockedByTarget: true,
  })
  const signedOut = resolveProfileActionState({
    ...base,
    connectionState: 'none',
    isAuthenticated: false,
  })

  assert.equal(blocked.isInteractionBlocked, true)
  assert.equal(blocked.showRelationshipAction, false)
  assert.equal(blocked.showMessageAction, false)
  assert.equal(signedOut.isInteractionBlocked, false)
  assert.equal(signedOut.showRelationshipAction, false)
  assert.equal(signedOut.showMessageAction, false)
})

test('message-only profiles receive an Actions dropdown', () => {
  const state = resolveProfileActionState({
    ...base,
    connectionState: 'none',
    canSendConnectionRequest: false,
    canSendMessage: true,
    canManageBlock: false,
    hasSecondaryHandler: false,
  })

  assert.equal(state.hasConnectionMenuAction, false)
  assert.equal(state.relationshipControlLabel, 'Actions')
  assert.equal(state.relationshipControlVariant, 'outline')
  assert.equal(state.showMessageAction, true)
  assert.equal(state.showRelationshipAction, true)
})

test('blocker can manage block from profile UI (SEC-010 UI unblock)', () => {
  const blocker = resolveProfileActionState({
    ...base,
    connectionState: 'none',
    canSendMessage: false,
    canSendConnectionRequest: false,
    blockedByViewer: true,
    blockedByTarget: false,
    canManageBlock: true,
  })

  assert.equal(blocker.isInteractionBlocked, true)
  assert.equal(blocker.showRelationshipAction, true)
  assert.equal(blocker.relationshipControlLabel, 'Blocked')
})

