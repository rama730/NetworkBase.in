import assert from 'node:assert/strict';
import test from 'node:test';
import { createFeedbackStore, FEEDBACK_HISTORY_LIMIT, FEEDBACK_QUEUE_LIMIT, readingDuration } from '../../src/lib/feedback/store';
import { compactFeedback, deferredFeedback, feedbackError, feedbackStore, toast } from '../../src/lib/feedback';

test('every shown message consumes active time; pauses protect reading and local Undo (the mix stack)', () => {
  const store = createFeedbackStore(); let committed = 0;
  const first = store.put('info', 'Message deleted', { duration: 10000, action: { label: 'Undo', onClick() {} }, onAutoClose: () => committed++ });
  const second = store.put('success', 'Changes saved');
  store.advance(9000, true);
  assert.equal(store.getSnapshot().items[0]!.remaining, 10000);
  store.advance(9000, false);
  assert.equal(committed, 0);
  assert.ok(!store.getSnapshot().items.some(item => item.id === second), 'the 4 s result ran out alongside');
  assert.equal(store.getSnapshot().items[0]!.remaining, 1000);
  store.advance(1000, false);
  assert.equal(committed, 1);
  assert.ok(!store.getSnapshot().items.some(item => item.id === first));
});

test('operation updates preserve identity and queued outcomes; distinct actions never merge', () => {
  const store = createFeedbackStore();
  const id = store.put('loading', 'Uploading 8 files');
  store.put('success', 'Link copied'); store.put('success', 'Link copied');
  store.put('warning', '6 uploaded · 2 failed', { id, action: { label: 'Retry failed', onClick() {} } });
  assert.equal(store.getSnapshot().items.length, 2);
  assert.equal(store.getSnapshot().items[1]!.count, 2);
  assert.ok(store.getSnapshot().shown.includes(id));
  store.put('info', 'Message deleted', { action: { label: 'Undo', onClick() {} } });
  store.put('info', 'Message deleted', { action: { label: 'Undo', onClick() {} } });
  assert.equal(store.getSnapshot().items.length, 4);
});

test('errors and constraints persist; an absolute server deadline still expires while paused', () => {
  let time = 1000, expired = 0;
  const store = createFeedbackStore(() => time);
  store.put('error', 'Changes not saved', { duration: 100 });
  store.advance(50000, false);
  assert.equal(store.getSnapshot().items.length, 1);
  const deadline = store.put('info', 'Undo', { deadline: 2000, onAutoClose: () => expired++ });
  time = 2001; store.advance(1, true);
  assert.equal(expired, 1);
  assert.ok(!store.getSnapshot().items.some(item => item.id === deadline));
});

test('finite queues archive overflow without discarding the current action or retaining unbounded history', () => {
  const store = createFeedbackStore();
  const current = store.put('info', 'Message deleted', { action: { label: 'Undo', onClick() {} } });
  for (let i = 0; i < 250; i++) store.put('success', `Saved ${i}`);
  assert.equal(store.getSnapshot().items.length, FEEDBACK_QUEUE_LIMIT);
  assert.equal(store.getSnapshot().history.length, FEEDBACK_HISTORY_LIMIT);
  assert.ok(store.getSnapshot().shown.includes(current), 'a shown Undo is never evicted');
  assert.ok(store.getSnapshot().items.some(item => item.id === current));
  assert.ok(store.getSnapshot().overflow > 0);
});

test('stale queued routine results expire but unresolved errors remain', () => {
  let time = 0;
  const store = createFeedbackStore(() => time);
  store.put('loading', 'Working'); store.put('loading', 'Uploading'); store.put('loading', 'Moving');
  store.put('success', 'Saved');
  const error = store.put('error', 'Not saved');
  time = 61000; store.advance(1, true);
  assert.ok(!store.getSnapshot().items.some(item => item.title === 'Saved'));
  assert.ok(store.getSnapshot().items.some(item => item.id === error));
});

test('deferred Undo and dismissal settle a local mutation exactly once', async () => {
  toast.clear(); let undone = 0, committed = 0;
  const op = deferredFeedback('Message deleted', () => undone++, () => committed++);
  feedbackStore.getSnapshot().items[0]!.action!.onClick({} as never);
  op.commit();
  assert.equal(undone, 1); assert.equal(committed, 0);
  const next = deferredFeedback('Message deleted', () => undone++, () => committed++);
  toast.dismiss(next.id); next.commit();
  assert.equal(committed, 1); toast.clear();
});

test('promise unwrap preserves rejection, skips fast loading, and resolves the existing operation', async () => {
  toast.clear();
  const value = await toast.promise(Promise.resolve(7), { loading: 'Saving…', success: 'Changes saved' }).unwrap();
  assert.equal(value, 7);
  assert.equal(feedbackStore.getSnapshot().items[0]!.type, 'success');
  assert.equal(feedbackStore.getSnapshot().items.length, 1);
  const error = new Error('private diagnostic');
  await assert.rejects(toast.promise(Promise.reject(error), { loading: 'Saving…', error: () => 'Failed to save changes' }).unwrap(), e => e === error);
  assert.ok(!feedbackStore.getSnapshot().items.some(item => item.title === 'private diagnostic'));
  toast.clear();
});

test('an operation completing after account clear cannot resurrect private feedback', async () => {
  toast.clear(); let resolve!: (value: string) => void;
  const operation = toast.promise(new Promise<string>(done => { resolve = done; }), { success: value => value, loading: 'Working…' });
  toast.clear(); resolve('Private workspace title'); await operation.unwrap();
  assert.equal(feedbackStore.getSnapshot().items.length, 0);
});

test('compact copy preserves numeric limits, semantics, and privacy; no preview people or dates leak', () => {
  assert.equal(compactFeedback('This file is too large', 'error').message, 'File too large');
  assert.equal(compactFeedback('Passwords do not match', 'error').type, 'warning');
  assert.equal(compactFeedback('File size exceeds the 10 MB upload limit', 'error').options.description, 'Upload limit: 10 MB.');
  assert.equal(compactFeedback('Uploading 3 of 8 files…', 'loading').options.progress?.completed, 3);
  assert.equal(feedbackError('SELECT secret FROM private_table', 'Couldn’t save file'), 'Couldn’t save file');
  assert.equal(compactFeedback('Message scheduled', 'success').options.description, undefined);
});

test('queued recovery takes the next free slot without replacing active Undo', () => {
  const store = createFeedbackStore();
  const current = store.put('info', 'Message deleted', { action: { label: 'Undo', onClick() {} } });
  store.put('success', 'Task created'); store.put('success', 'Link copied');
  const waiting = store.put('success', 'Changes saved'); const failure = store.put('error', 'Changes not saved');
  assert.ok(store.getSnapshot().shown.includes(current));
  assert.ok(!store.getSnapshot().shown.includes(failure));
  store.remove(current, 'action');
  assert.equal(store.getSnapshot().currentId, failure);
  assert.ok(!store.getSnapshot().shown.includes(waiting));
});

test('long operations retain their action and identity when the status changes to Still working', () => {
  let now = 0; const store = createFeedbackStore(() => now);
  const id = store.put('loading', 'Uploading 8 files', { action: { label: 'Cancel', onClick() {} } });
  now = 15001; store.advance(0, true);
  const item = store.getSnapshot().items[0]!;
  assert.equal(item.id, id); assert.equal(item.title, 'Still working…'); assert.equal(item.action?.label, 'Cancel');
});

test('toast formatting cannot change a promise operation result or rollback rejection', async () => {
  toast.clear();
  assert.equal(await toast.promise(Promise.resolve(8), { success: () => { throw new Error('formatter failure'); } }).unwrap(), 8);
  const original = new Error('server failure');
  await assert.rejects(toast.promise(Promise.reject(original), { error: () => { throw new Error('formatter failure'); } }).unwrap(), e => e === original);
  toast.clear();
});

test('late updates from a cleared account cannot recreate a manual operation toast', () => {
  const store = createFeedbackStore();
  const old = store.put('loading', 'Uploading private file');
  store.clear(); store.put('success', 'Private file uploaded', { id: old });
  assert.equal(store.getSnapshot().items.length, 0);
  const fresh = store.put('success', 'Changes saved');
  assert.notEqual(fresh, old);
  assert.equal(store.getSnapshot().items.length, 1);
});

test('hierarchy validation retains a useful safe reason without leaking a raw server diagnostic', () => {
  const result = compactFeedback(feedbackError('Cannot move a folder into its own descendant.'), 'error');
  assert.equal(result.message, 'Invalid move destination');
  assert.equal(result.type, 'warning');
  assert.equal(result.options.description, 'Choose a folder outside this item.');
});

test('five toast types and their closing rules (decisions 46, 47)', () => {
  const action = { label: 'Retry', onClick() {} };
  assert.equal(readingDuration('error', {}), Infinity);
  assert.equal(readingDuration('loading', {}), Infinity);
  assert.ok(Number.isFinite(readingDuration('warning', {})));
  assert.equal(readingDuration('warning', {}, action), Infinity);
  const id = toast.message('Theme switched');
  assert.equal(feedbackStore.getSnapshot().items.find((item) => item.id === id)?.type, 'info');
  toast.dismiss(id);
});

test('error toasts end with a next step: Retry when the caller can try again, and the connection when that failed (0.8 #6)', async () => {
  toast.clear();
  let tries = 0;
  const id = toast.error('Failed to fetch', { retry: () => { tries += 1; } });
  const item = feedbackStore.getSnapshot().items.find((i) => i.id === id)!;
  assert.equal(item.action && 'label' in item.action ? item.action.label : null, 'Retry');
  assert.equal(item.description, 'Check your connection, then retry.');
  (item.action as { onClick: (e?: unknown) => void }).onClick();
  assert.equal(tries, 1);
  toast.clear();
  const plainId = toast.error('Failed to fetch');
  const plain = feedbackStore.getSnapshot().items.find((i) => i.id === plainId)!;
  assert.equal(plain.action, undefined, 'no Retry where the caller can’t retry');
  assert.equal(plain.description, 'Check your connection and try again.');
  toast.clear();
  // A promise made by a function is simply made again.
  let runs = 0;
  const failing = () => { runs += 1; return Promise.reject(new Error('Failed to fetch')); };
  await toast.promise(failing, { error: 'Couldn’t load' }).unwrap().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 0));
  const failed = feedbackStore.getSnapshot().items.find((i) => i.type === 'error' && i.action && 'label' in i.action && i.action.label === 'Retry' && i.id !== id);
  assert.ok(failed, 'the promise toast offers Retry');
  (failed!.action as { onClick: (e?: unknown) => void }).onClick();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(runs, 2);
  toast.clear();
});
