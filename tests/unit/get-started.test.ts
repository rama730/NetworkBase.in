import assert from 'node:assert/strict';
import test from 'node:test';

// Create workspace v6 (Task 9): Get started remembers its tasks per workspace, in this browser.
const store = new Map<string, string>();
(globalThis as any).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    dispatchEvent: () => true,
};
(globalThis as any).CustomEvent = class { constructor(public type: string, public init?: unknown) {} };

test('writes merge into what is there; open tasks are the ones not done', async () => {
    const { readGetStarted, writeGetStarted, openTasks } = await import('../../src/lib/workspaces/get-started');
    assert.deepEqual(readGetStarted('w1'), { hidden: false, done: [], tasks: [] });
    writeGetStarted('w1', { tasks: ['invite', 'share', 'doc'] });
    const state = writeGetStarted('w1', { done: ['share'] });
    assert.deepEqual(state.tasks, ['invite', 'share', 'doc']);
    assert.deepEqual(openTasks(state), ['invite', 'doc']);
    assert.equal(readGetStarted('w2').tasks.length, 0);
});

test('a broken entry reads as empty instead of throwing', async () => {
    const { readGetStarted } = await import('../../src/lib/workspaces/get-started');
    store.set('nb-get-started:w3', '{not json');
    assert.deepEqual(readGetStarted('w3'), { hidden: false, done: [], tasks: [] });
});
