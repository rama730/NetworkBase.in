import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isBigEmoji } from '../../src/lib/messaging/emoji';

const row = readFileSync('src/components/messages/MessageRow.tsx', 'utf8');
const body = readFileSync('src/components/messages/MessageBody.tsx', 'utf8');
const lp = readFileSync('src/components/messages/parts/LinkPreviewCard.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('fold: watches its content (resize, images, edits) and clips only when it overflows', () => {
  assert.match(row, /new ResizeObserver\(/);
  assert.match(row, /<div ref=\{inner\}>\{children\}<\/div>/);
  assert.match(css, /\.nbm-fold-body\[data-folded="true"\]\[data-over="true"\]\s*\{[^}]*max-height:[^}]*overflow:\s*clip/);
  assert.doesNotMatch(css, /\.nbm-fold-body\[data-folded="true"\]\s*\{\s*max-height/);
});

test('poll card: names for tokens in the question and options; who voted on hover', () => {
  assert.match(row, /tokensToPlainText\(poll\.question, ctx\.nameOf, ctx\.channelNameOf\)|plain\(poll\.question\)/);
  assert.match(row, /function PollOption\(/);
  assert.match(row, /reacted with \$\{option\.emoji\}|voted for/);
});

test('row hover is visible on the card background; the grouped clock is hidden until hover, gone on touch', () => {
  assert.match(css, /\.nbm-msg:hover, \.nbm-msg:focus-within\s*\{[^}]*background-color:\s*var\(--nbm-soft\)/);
  assert.match(css, /\.nbm-gutter-time\s*\{[^}]*visibility:\s*hidden/);
  assert.match(css, /@media \(pointer: coarse\) \{ \.nbm-gutter-time \{ display: none; \} \}/);
});

test('flash fades to the row’s own fill (no blank mention rows)', () => {
  assert.match(css, /@keyframes nbm-flash \{ from \{ background-color: var\(--nbm-tint\); \} \}/);
});

test('isBigEmoji ignores text-style symbols', () => {
  for (const t of ['©', '™', '↔', '🇮']) assert.equal(isBigEmoji(t), false, t);
  for (const t of ['🎉', '❤️', '1️⃣', '👍🏽', '🇮🇳', '👨‍👩‍👧']) assert.equal(isBigEmoji(t), true, t);
});

test('small fixes: link preview × is 44px on touch; Show image never follows a wrapping link; log date column fits', () => {
  assert.match(css, /@media \(pointer: coarse\) \{ \.nbm-lp-x \{ width: 44px; height: 44px; \} \}/);
  assert.match(body, /onClick=\{\(event\) => \{ event\.preventDefault\(\); event\.stopPropagation\(\); setShown\(true\); \}\}/);
  assert.match(css, /\.nbm-log > li\s*\{[^}]*grid-template-columns:\s*120px/);
  assert.match(css, /\.nbm-folded button:hover\s*\{[^}]*color:\s*var\(--nbm-brand\)/);
});
