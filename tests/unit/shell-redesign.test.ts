import assert from 'node:assert/strict'
import test from 'node:test'
import { LOGO_ANIMATIONS, pickLoadAnimation } from '../../src/lib/ui/logo-animations'
import { isPlacePath, shellPathFor, shellPartsFor } from '../../src/lib/navigation/shell-path'

test('the logo retypes on the first visit of the day, otherwise never repeats the last animation', () => {
    assert.equal(pickLoadAnimation('2026-11-19', '2026-11-18', 'wave'), 'retype')
    assert.equal(pickLoadAnimation('2026-11-19', null, null), 'retype')
    for (const r of [0, 0.2, 0.5, 0.99]) {
        const name = pickLoadAnimation('2026-11-19', '2026-11-19', 'hop', r)
        assert.notEqual(name, 'hop')
        assert.ok(LOGO_ANIMATIONS.includes(name))
    }
})

test('the top bar path shows the place, never ids, at most two parts', () => {
    assert.equal(shellPathFor('/discover'), 'discover')
    assert.equal(shellPathFor('/workspaces/alpha-app/tasks'), 'workspaces/alpha-app')
    assert.equal(shellPathFor('/messages/3f2b1c4a-1d2e-4f5a-9b8c-7d6e5f4a3b2c'), 'messages')
    assert.equal(shellPathFor('/settings/account'), 'settings/account')
    assert.equal(shellPathFor('/'), 'discover')
    // A long slug is a place, not an id.
    assert.equal(shellPathFor('/workspaces/team-falcon-hash-table-library-oxao5'), 'workspaces/team-falcon-hash-table-library-oxao5')
    assert.equal(shellPathFor('/messages/ckq2x9v0a0000qz1h3k5d7f9g'), 'messages')
})

test('a workspace or organization shows its real name in the path, never its address', () => {
    assert.deepEqual(shellPartsFor('/workspaces/network-for-builders', 'Network for builders'), ['workspaces', 'Network for builders'])
    assert.deepEqual(shellPartsFor('/workspaces/network-for-builders/tasks', 'Network for builders'), ['workspaces', 'Network for builders'])
    assert.deepEqual(shellPartsFor('/org/iit-madras', 'IIT Madras'), ['org', 'IIT Madras'])
    // A name with a slash stays one part.
    assert.deepEqual(shellPartsFor('/workspaces/acme-billing', 'Acme / Billing'), ['workspaces', 'Acme / Billing'])
    // Stray spaces in a saved name don't show.
    assert.deepEqual(shellPartsFor('/workspaces/network-for-builders', 'Network for builders '), ['workspaces', 'Network for builders'])
    // Until the name is known, the address is not shown.
    assert.deepEqual(shellPartsFor('/workspaces/network-for-builders', null), ['workspaces'])
    // Not a place: unchanged.
    assert.deepEqual(shellPartsFor('/workspaces/new', null), ['workspaces', 'new'])
    assert.deepEqual(shellPartsFor('/settings/account', 'ignored'), ['settings', 'account'])
    assert.equal(isPlacePath('/workspaces/new'), false)
    assert.equal(isPlacePath('/org/iit-madras/members'), true)
})
