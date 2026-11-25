import assert from 'node:assert/strict';
import test from 'node:test';
import { createFeedbackStore, FEEDBACK_VISIBLE } from '../../src/lib/feedback/store';
import { countdownCells, overflowLabel, overflowName, undoLabel } from '../../src/lib/feedback/stack';

const undo = () => ({ label: 'Undo', onClick() {} });

test('three toasts show at once; a fourth waits', () => {
  const store = createFeedbackStore();
  const ids = ['One', 'Two', 'Three', 'Four'].map((t) => store.put('success', t));
  assert.equal(FEEDBACK_VISIBLE, 3);
  assert.deepEqual(store.getSnapshot().shown, ids.slice(0, 3));
  assert.equal(store.getSnapshot().currentId, ids[2], 'the newest shown is the front card');
});

test('a waiting error fills the next free slot before older waiting toasts', () => {
  let time = 0;
  const store = createFeedbackStore(() => time);
  const first = store.put('success', 'One'); time++;
  store.put('success', 'Two'); time++;
  store.put('success', 'Three'); time++;
  store.put('success', 'Four'); time++;
  const error = store.put('error', 'Changes not saved');
  store.remove(first);
  assert.ok(store.getSnapshot().shown.includes(error));
  assert.ok(!store.getSnapshot().shown.some((id) => store.getSnapshot().items.find((i) => i.id === id)?.title === 'Four'));
});

test('every shown toast runs its own clock; a pause stops them all', () => {
  const store = createFeedbackStore();
  const a = store.put('success', 'Saved');
  const b = store.put('info', 'Link copied');
  store.advance(1000, true);
  assert.ok(store.getSnapshot().items.every((i) => i.remaining === 4000));
  store.advance(1000, false);
  assert.equal(store.getSnapshot().items.find((i) => i.id === a)!.remaining, 3000);
  assert.equal(store.getSnapshot().items.find((i) => i.id === b)!.remaining, 3000);
  store.advance(3000, false);
  assert.equal(store.getSnapshot().items.length, 0);
});

test('a waiting toast keeps its full time until it shows', () => {
  const store = createFeedbackStore();
  ['One', 'Two', 'Three'].forEach((t) => store.put('success', t));
  const waiting = store.put('success', 'Four');
  store.advance(2000, false);
  assert.equal(store.getSnapshot().items.find((i) => i.id === waiting)!.remaining, 4000);
});

test('errors go to the assertive region, the rest to the polite one', () => {
  const store = createFeedbackStore();
  store.put('success', 'Saved');
  assert.equal(store.getSnapshot().announcement.text, 'Saved');
  store.put('error', 'Changes not saved', { description: 'Try again.' });
  assert.equal(store.getSnapshot().alert.text, 'Changes not saved. Try again.');
  assert.equal(store.getSnapshot().announcement.text, 'Saved');
});

test('Undo says its time once, when it shows', () => {
  const store = createFeedbackStore();
  store.put('info', 'Message deleted', { duration: 10_000, action: undo() });
  assert.equal(store.getSnapshot().announcement.text, 'Message deleted. Action available: Undo. 10 seconds to undo.');
});

test('select brings a waiting toast to the front and sends the oldest shown back to wait', () => {
  const store = createFeedbackStore();
  const [one, two, three, four] = ['One', 'Two', 'Three', 'Four'].map((t) => store.put('success', t));
  store.advance(1000, false);
  store.select(four!);
  assert.deepEqual(store.getSnapshot().shown, [two, three, four]);
  assert.equal(store.getSnapshot().currentId, four);
  assert.equal(store.getSnapshot().items.find((i) => i.id === one)!.remaining, 3000, 'it keeps its time');
});

test('select never sends an error back to wait when something else can go', () => {
  const store = createFeedbackStore();
  const error = store.put('error', 'Not saved');
  const two = store.put('success', 'Two');
  store.put('success', 'Three');
  const four = store.put('success', 'Four');
  store.select(four);
  assert.ok(store.getSnapshot().shown.includes(error));
  assert.ok(!store.getSnapshot().shown.includes(two));
});

test('a merged repeat keeps its place in the stack', () => {
  const store = createFeedbackStore();
  const copied = store.put('success', 'Link copied');
  store.put('success', 'Saved');
  store.put('success', 'Link copied');
  assert.equal(store.getSnapshot().shown[0], copied);
  assert.equal(store.getSnapshot().items.find((i) => i.id === copied)!.count, 2);
});

test('countdown: ten squares, the rightmost goes out first', () => {
  assert.deepEqual(countdownCells(10_000, 10_000), Array(10).fill(true));
  assert.deepEqual(countdownCells(7_000, 10_000), [...Array(7).fill(true), ...Array(3).fill(false)]);
  assert.deepEqual(countdownCells(6_100, 10_000).filter(Boolean).length, 7);
  assert.deepEqual(countdownCells(0, 10_000), Array(10).fill(false));
});

test('undo label, overflow row and its name', () => {
  assert.equal(undoLabel(6_100, false), '7 S');
  assert.equal(undoLabel(7_000, true), 'PAUSED · 7 S');
  assert.equal(overflowLabel(2, 1), '+2 more · 1 issue');
  assert.equal(overflowLabel(4, 3), '+4 more · 3 issues');
  assert.equal(overflowLabel(2, 0), '+2 more');
  assert.equal(overflowName(2), '2 more waiting, open Pending feedback');
});

import { stackRows } from '../../src/lib/feedback/stack';
import { readFileSync } from 'node:fs';

const item = (id: string) => ({ id }) as never;

test('stackRows: a card that leaves keeps its place while it fades; new cards come in at the front', () => {
  const a = item('a'), b = item('b'), c = item('c'), d = item('d');
  const first = stackRows([], [a, b, c]);
  assert.deepEqual(first.map((r) => [r.item, r.leaving]), [[a, false], [b, false], [c, false]]);
  const next = stackRows(first, [a, c, d]);
  assert.deepEqual(next.map((r) => [(r.item as { id: string }).id, r.leaving]), [['a', false], ['b', true], ['c', false], ['d', false]]);
  const again = stackRows(next, [a, c, d]);
  assert.deepEqual(again.map((r) => (r.item as { id: string }).id), ['a', 'b', 'c', 'd'], 'still leaving, still in place');
});

const host = readFileSync('src/components/feedback/FeedbackHost.tsx', 'utf8');
const css = readFileSync('src/components/feedback/feedback.css', 'utf8');

test('the card: square glyph, words, one action cell, close named for the title, Undo squares hidden from readers', () => {
  assert.match(host, /className="nb-feedback-glyph"/);
  assert.match(host, /aria-label=\{`Dismiss \$\{label\}`\}/);
  assert.match(host, /className="nb-feedback-clock" aria-hidden="true"/);
  assert.match(host, /countdownCells\(/);
  assert.match(host, /undoLabel\(/);
  assert.doesNotMatch(host, /nb-feedback-countdown|nb-feedback-seconds|nb-feedback-chip/);
});

test('the stack: shelves are inert until fanned, the overflow row opens Pending feedback, only the front card is "toast"', () => {
  assert.match(host, /inert=\{shelf \|\| undefined\}/);
  assert.match(host, /data-fanned=\{fanned\}/);
  assert.match(host, /aria-label=\{overflowName\(waiting\)\}/);
  assert.match(host, /overflowLabel\(waiting, issues\)/);
  assert.match(host, /data-testid=\{isFront \? \(row\.item\.options\.testId \?\? "toast"\) : undefined\}/);
});

test('two live regions: polite for most, assertive for errors', () => {
  assert.match(host, /role="status" aria-live="polite"/);
  assert.match(host, /role="alert"[^>]*>\s*<span key=\{snapshot\.alert\.serial\}>/);
});

test('toast CSS: 360 px card, square cells, 8 px shelves at 94 % and 88 %, reduced motion fades only', () => {
  assert.match(css, /--feedback-width:\s*360px/);
  assert.match(css, /\[data-shelf="1"\][^{]*\{[^}]*width:\s*94%/);
  assert.match(css, /\[data-shelf="2"\][^{]*\{[^}]*width:\s*88%/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /border-radius:\s*(?:12px|9999px|50%)/);
});

import { cornerOffsets, toastPlace } from '../../src/lib/feedback/placement';

test('placement priority: a dialog, then a phone, then the pane you acted in, then beside the window, then the corner', () => {
  const base = { dialog: false, mobile: false, pane: false, window: false };
  assert.equal(toastPlace({ ...base, dialog: true, mobile: true, pane: true }), 'modal');
  assert.equal(toastPlace({ ...base, mobile: true, pane: true }), 'phone');
  assert.equal(toastPlace({ ...base, pane: true, window: true }), 'pane');
  assert.equal(toastPlace({ ...base, window: true }), 'window');
  assert.equal(toastPlace(base), 'corner');
});

test('corner offsets: above the launcher (24 + 56 + 12), left of the window (24 + 400 + 12), else 24', () => {
  assert.deepEqual(cornerOffsets({ window: true, launcher: true }), { right: 436, bottom: 24 });
  assert.deepEqual(cornerOffsets({ window: false, launcher: true }), { right: 24, bottom: 92 });
  assert.deepEqual(cornerOffsets({ window: false, launcher: false }), { right: 24, bottom: 24 });
});

test('the app sidebar no longer holds toasts; the host follows the chat panes', () => {
  const sidebar = readFileSync('src/components/layout/AppSidebar.tsx', 'utf8');
  assert.doesNotMatch(sidebar, /navigation-feedback-slot/);
  assert.doesNotMatch(host, /navigation-feedback-slot|'navigation'/);
  assert.match(host, /closest<HTMLElement>\('\[data-chat-pane\]'\)/);
  assert.match(host, /\.nb-message-composer/);
  assert.doesNotMatch(css, /navigation-feedback-slot/);
});
