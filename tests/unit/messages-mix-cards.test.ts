import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { pollBody, pollParts, pollStats } from '../../src/lib/messaging/poll';

test('pollParts reads the question and every option with its label', () => {
  const parts = pollParts(pollBody('/poll Best time? | Monday | Tuesday')!)!;
  assert.equal(parts.question, 'Best time?');
  assert.deepEqual(parts.options, [{ emoji: '1️⃣', label: 'Monday' }, { emoji: '2️⃣', label: 'Tuesday' }]);
  assert.deepEqual(pollParts(pollBody('/poll Ship it?')!)!.options.map((o) => o.label), ['Yes', 'No', 'Maybe']);
  assert.equal(pollParts('hello'), null);
});

test('pollStats: votes per option, the total, each option’s share; zero when nobody voted', () => {
  const options = [{ emoji: '1️⃣', label: 'A' }, { emoji: '2️⃣', label: 'B' }];
  const stats = pollStats(options, [{ emoji: '1️⃣', count: 3, me: true }, { emoji: '❤️', count: 9, me: false }, { emoji: '2️⃣', count: 1, me: false }]);
  assert.equal(stats.votes, 4);
  assert.deepEqual(stats.options.map((o) => [o.count, o.share, o.me]), [[3, 75, true], [1, 25, false]]);
  assert.deepEqual(pollStats(options, []).options.map((o) => o.share), [0, 0]);
});

const row = readFileSync('src/components/messages/MessageRow.tsx', 'utf8');
const parts = readFileSync('src/components/messages/cards/card-parts.tsx', 'utf8');
const app = readFileSync('src/components/messages/cards/ApplicationCard.tsx', 'utf8');
const lp = readFileSync('src/components/messages/parts/LinkPreviewCard.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('poll card: one button per option with a bar, "No votes yet", "Pick any"', () => {
  assert.match(row, /<PollCard /);
  assert.match(row, /No votes yet/);
  assert.match(row, /Pick any/);
  assert.match(row, /aria-pressed=\{option\.me\}/);
  assert.match(css, /\.nbm-poll-bar\s*\{[^}]*transition:\s*width var\(--nbm-m3\)/);
});

test('cards share one grammar: kind label + status in a hairline head, a paper footer for actions', () => {
  assert.match(parts, /className="nbm-card"/);
  assert.match(parts, /className="nbm-card-head"/);
  assert.match(parts, /className="nbm-card-foot"/);
  assert.match(css, /\.nbm-card-foot\s*\{[^}]*border-top:\s*1px solid var\(--nbm-line\)[^}]*background:\s*var\(--nbm-soft\)/);
});

test('application: a mini log with a mono date column (no left bar); the status bar is a hairline strip', () => {
  assert.doesNotMatch(app, /border-l border-border pl-3/);
  assert.match(app, /className="nbm-log"/);
  assert.match(app, /className="nbm-appbar"/);
  assert.match(css, /\.nbm-log > li\s*\{[^}]*grid-template-columns/);
});

test('link preview: hairline card on the card fill, mono domain', () => {
  assert.match(lp, /className="nbm-lp msg-rich-content"/);
  assert.match(lp, /className="nbm-lp-domain"/);
  assert.match(css, /\.nbm-lp\s*\{[^}]*border:\s*1px solid var\(--nbm-line\)[^}]*background:\s*var\(--card\)/);
});
