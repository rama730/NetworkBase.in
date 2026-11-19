import assert from 'node:assert/strict'
import test from 'node:test'
import { LOGO_ANIMATIONS, pickLoadAnimation } from '../../src/lib/ui/logo-animations'
import { shellPathFor } from '../../src/lib/navigation/shell-path'

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
})
