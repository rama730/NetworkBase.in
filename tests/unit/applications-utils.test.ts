import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateCooldown,
    normalizeApplicationMessageText,
    resolveLifecycleStatus,
} from '@/lib/applications/utils';

test('calculateCooldown returns canApply when elapsed exceeds cooldown window', () => {
    const now = new Date('2026-02-17T12:00:00.000Z').getTime();
    const updatedAt = new Date(now - 25 * 60 * 60 * 1000);
    assert.deepEqual(calculateCooldown(updatedAt, now), { canApply: true });
});

test('calculateCooldown returns wait time when still in cooldown window', () => {
    const now = new Date('2026-02-17T12:00:00.000Z').getTime();
    const updatedAt = new Date(now - (2 * 60 * 60 * 1000 + 30 * 60 * 1000));
    const result = calculateCooldown(updatedAt, now);
    assert.equal(result.canApply, false);
    assert.equal(result.waitTime, '21h 30m');
});

test('normalizeApplicationMessageText keeps the applicant\'s text as written', () => {
    const raw = '  I can contribute now.\r\n\r\n\r\n\r\ngithub.com/example/repo  \ngithub.com/example/repo\nAvailability: 15 hrs/week  ';
    assert.equal(
        normalizeApplicationMessageText(raw),
        'I can contribute now.\n\ngithub.com/example/repo\ngithub.com/example/repo\nAvailability: 15 hrs/week',
    );
});

test('normalizeApplicationMessageText never truncates (length is validated, not trimmed)', () => {
    assert.equal(normalizeApplicationMessageText('x'.repeat(5000)).length, 5000);
});

test('the input schema bounds ids and message length', async () => {
    const { applyToRoleInputSchema, APPLICATION_MESSAGE_MAX } = await import('@/lib/validations/application');
    const ids = { projectId: '11111111-1111-4111-8111-111111111111', roleId: '22222222-2222-4222-8222-222222222222' };
    assert.equal(applyToRoleInputSchema.safeParse({ ...ids, message: 'hi' }).success, true);
    assert.equal(applyToRoleInputSchema.safeParse({ ...ids, message: '   ' }).success, false);
    assert.equal(applyToRoleInputSchema.safeParse({ ...ids, message: 'x'.repeat(APPLICATION_MESSAGE_MAX + 1) }).success, false);
    assert.equal(applyToRoleInputSchema.safeParse({ ...ids, roleId: 'nope', message: 'hi' }).success, false);
    assert.equal(applyToRoleInputSchema.safeParse({ ...ids, message: { toString: 'x' } }).success, false);
});

test('resolveLifecycleStatus handles known terminal reasons', () => {
    assert.equal(resolveLifecycleStatus('pending', null), 'pending');
    assert.equal(resolveLifecycleStatus('accepted', null), 'accepted');
    assert.equal(resolveLifecycleStatus('rejected', 'withdrawn_by_applicant'), 'withdrawn');
    assert.equal(resolveLifecycleStatus('rejected', 'role_filled'), 'role_filled');
    assert.equal(resolveLifecycleStatus('rejected', 'cancelled'), 'rejected');
    assert.equal(resolveLifecycleStatus('rejected', 'other_reason'), 'rejected');
});
