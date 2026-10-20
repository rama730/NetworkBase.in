import test from 'node:test'
import assert from 'node:assert/strict'
import { blockReason, urlFieldError, type BlockInput, type UsernameCheck } from '@/lib/onboarding/block-reason'

const links = { github: '', linkedin: '', x: '', portfolio: '' }
const input: BlockInput = { fullName: 'Ada Lovelace', username: 'ada_l', skills: ['React'], website: '', socialLinks: links }
const valid: UsernameCheck = { username: 'ada_l', status: 'valid' }

test('step 1 needs a name and a username the check approved for that exact name', () => {
    assert.equal(blockReason(1, input, valid, false), undefined)
    assert.match(blockReason(1, { ...input, fullName: ' a ' }, valid, false)!, /full name/)
    assert.match(blockReason(1, { ...input, username: 'a' }, valid, false)!, /username/)
    assert.match(blockReason(1, input, { username: 'ada_l', status: 'checking' }, false)!, /Checking/)
    assert.match(blockReason(1, input, { username: 'old_name', status: 'valid' }, false)!, /Checking/, 'a verdict for the previous name is not a verdict')
    assert.match(blockReason(1, input, { username: 'ada_l', status: 'invalid' }, false)!, /available/)
})

test('a check that could not run does not trap the person: the server checks again on save', () => {
    assert.equal(blockReason(1, input, { username: 'ada_l', status: 'error' }, false), undefined)
})

test('an upload in progress blocks every step, so a blob: preview URL is never saved', () => {
    for (const step of [1, 2, 3, 4]) assert.match(blockReason(step, input, valid, true)!, /photo/)
})

test('step 2 is optional but a filled-in link must be valid', () => {
    assert.equal(blockReason(2, input, valid, false), undefined)
    assert.match(blockReason(2, { ...input, website: 'javascript:alert(1)' }, valid, false)!, /website/)
    assert.match(blockReason(2, { ...input, socialLinks: { ...links, github: 'not a url' } }, valid, false)!, /link/)
    assert.equal(blockReason(2, { ...input, website: 'example.com', socialLinks: { ...links, x: 'x.com/ada' } }, valid, false), undefined)
})

test('step 3 needs one skill; step 4 needs nothing more', () => {
    assert.match(blockReason(3, { ...input, skills: [] }, valid, false)!, /skill/)
    assert.equal(blockReason(3, input, valid, false), undefined)
    assert.equal(blockReason(4, { ...input, skills: [] }, valid, false), undefined)
})

test('urlFieldError counts the stored length, after https:// is added', () => {
    assert.equal(urlFieldError(''), null)
    assert.equal(urlFieldError('example.com'), null)
    assert.match(urlFieldError('b'.repeat(195) + '.com')!, /200/)
    assert.match(urlFieldError('http://localhost:3000')!, /valid/)
})
