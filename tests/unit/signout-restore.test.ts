import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldEjectRestoredPage } from '@/lib/auth/restored-page';

test('page restored from memory while signed out goes to login', () => {
    assert.equal(shouldEjectRestoredPage(true, false), true);
});

test('page restored from memory while signed in stays', () => {
    assert.equal(shouldEjectRestoredPage(true, true), false);
});

test('normal page load is left to the server', () => {
    assert.equal(shouldEjectRestoredPage(false, false), false);
});
