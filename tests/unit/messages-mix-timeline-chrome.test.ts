import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const timeline = readFileSync('src/components/messages/Timeline.tsx', 'utf8');
const latest = readFileSync('src/components/messages/parts/LatestBar.tsx', 'utf8');
const composer = readFileSync('src/components/messages/Composer.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('day rule: hairlines around a square mono chip that still jumps to a date', () => {
  assert.match(timeline, /className="nbm-day"/);
  assert.match(timeline, /className="nbm-day-chip/);
  assert.match(timeline, /title="Jump to a date"/);
  assert.match(css, /\.nbm-day-chip\s*\{[^}]*height:\s*22px[^}]*border-radius:\s*3px[^}]*var\(--nbm-mono\)[^}]*text-transform:\s*uppercase/);
});

test('NEW line: clay hairline and a clay square tag; screen readers still hear "New messages"', () => {
  assert.match(timeline, /className="nbm-newline" role="separator" aria-label="New messages"/);
  assert.match(timeline, /<span className="nbm-tag hot"[^>]*>New<\/span>/);
});

test('open banner is a hairline strip; Finding carries the pixel beat', () => {
  assert.match(timeline, /className="nbm-strip"/);
  assert.match(timeline, /className="nbm-finding"[\s\S]{0,200}<PixelBeat/);
  assert.match(timeline, / new message\{[^}]*\}s?"?\)?[\s\S]{0,40}since/);
  assert.match(css, /\.nbm-strip\s*\{[^}]*height:\s*36px/);
});

test('Jump to latest: a strip cell with a hot mono count; the words stay', () => {
  assert.match(latest, /className="nbm-latest"/);
  assert.match(latest, /<span className="nbm-count hot"/);
  assert.match(latest, /aria-label=\{unseen \? `\$\{label\}, \$\{unseen\} new` : label\}/);
});

test('typing: the pixel beat, names bold', () => {
  assert.match(composer, /<PixelBeat \/>/);
  assert.doesNotMatch(composer, /nb-typing-dots/);
});
