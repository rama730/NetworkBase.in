import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createFeedbackStore } from '../../src/lib/feedback/store';

const host = readFileSync('src/components/feedback/FeedbackHost.tsx', 'utf8');
const css = readFileSync('src/components/feedback/feedback.css', 'utf8');

test('errors interrupt through an assertive live region, never a second role="alert" on the page', () => {
  assert.match(host, /className="sr-only" aria-live="assertive" aria-atomic="true"><span key=\{snapshot\.alert\.serial\}>/);
  assert.doesNotMatch(host, /role="alert"/);
});

test('focus inside the stack is read when it happens and checked every tick (Safari sends no blur when a card is removed)', () => {
  assert.match(host, /addEventListener\('focusin'/);
  assert.match(host, /const inside = region\.current\?\.contains\(document\.activeElement\) \?\? false/);
  assert.doesNotMatch(host, /onBlur=/);
});

test('typing does not re-measure the page: placement re-syncs only when the pane you act in changes', () => {
  assert.match(host, /if \(next !== acted\) \{ acted = next; schedule\(\); \}/);
});

test('a hung action disables only its own card, and only until the card changes', () => {
  assert.match(host, /busy\.has\(`\$\{item\.id\}:\$\{item\.revision\}`\)/);
});

test('Escape closes a card only when focus is on a card', () => {
  assert.match(host, /if \(!card && !reviewing\) return;/);
});

test('the leaving set forgets ids, and dev reloads clear the timer map', () => {
  assert.match(host, /gone\.current\.delete\(id\)/);
  assert.match(host, /timers\.current\.clear\(\)/);
});

test('a hidden window or launcher does not move the stack', () => {
  assert.match(host, /window: visible\('\.nbm-window'\)/);
  assert.match(host, /launcher: visible\('\.nbm-launcher'\)/);
});

test('Pending feedback fits above the stack in every place; no dead trigger CSS; no gap before × on cards without an action', () => {
  assert.match(css, /max-height:min\(65dvh,560px,calc\(var\(--feedback-room,100dvh\) - 100% - 16px\)\)/);
  assert.match(css, /\[data-place=pane\] \.nb-feedback-queue\{right:auto;left:50%;transform:translateX\(-50%\);width:min\(320px,var\(--feedback-pane-width,320px\)\)\}/);
  assert.doesNotMatch(css, /nb-feedback-queue-trigger/);
  assert.match(css, /\.nb-feedback-card\{[^}]*gap:0;/);
});

test('an error that waited is not read out again when it moves up', () => {
  const store = createFeedbackStore();
  const first = store.put('success', 'One'); store.put('success', 'Two'); store.put('success', 'Three');
  store.put('error', 'Not saved');
  const serial = store.getSnapshot().alert.serial;
  store.remove(first);
  assert.equal(store.getSnapshot().alert.serial, serial);
});

test('a toast that has shown keeps its time when it goes back to wait; nothing unseen expires while the stack is held', () => {
  let time = 0;
  const store = createFeedbackStore(() => time);
  const one = store.put('success', 'One'); store.put('success', 'Two'); store.put('success', 'Three');
  const four = store.put('success', 'Four');
  store.select(four);
  time = 61_000; store.advance(1, false);
  assert.ok(store.getSnapshot().items.some((i) => i.id === one), 'shown once, so not "gone unseen"');
  const five = store.put('success', 'Five');
  time = 200_000; store.advance(1, true);
  assert.ok(store.getSnapshot().items.some((i) => i.id === five), 'held: the Pending list is open');
});
