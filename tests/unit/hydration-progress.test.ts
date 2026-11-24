import assert from 'node:assert/strict';
import test from 'node:test';
import { hydrationProgress } from '../../src/lib/workspaces/hydration-progress';

// The import writes `stored` (import-hydration.ts); the Files banner and the Creating screen read it as `completed`.
test('reads the stored count the import writes, and the status as is', () => {
    assert.deepEqual(hydrationProgress({ status: 'in_progress', stored: 44, total: 128 }), { status: 'in_progress', completed: 44, total: 128 });
    assert.deepEqual(hydrationProgress({ status: 'done', stored: 128, total: 128, remaining: 0 }), { status: 'done', completed: 128, total: 128 });
    assert.deepEqual(hydrationProgress({ status: 'queued' }), { status: 'queued', completed: 0, total: 0 });
    assert.equal(hydrationProgress(null), null);
    assert.equal(hydrationProgress({ total: 3 }), null);
});
