import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');
const bar = readFileSync('src/components/messages/ChannelTabBar.tsx', 'utf8');
const timeline = readFileSync('src/components/messages/Timeline.tsx', 'utf8');
const view = readFileSync('src/components/messages/ConversationView.tsx', 'utf8');
const skeleton = readFileSync('src/components/messages/ConversationSkeleton.tsx', 'utf8');

test('touch: a closable tab keeps room for its × (the mix padding would beat pr-8)', () => {
  assert.match(bar, /data-closable=\{closable \? "true" : undefined\}/);
  assert.match(css, /@media \(pointer: coarse\) \{[^}]*\.nbm-tab\[data-closable="true"\] \{ padding-right: 32px; \}/);
});

test('the floating day chip has no invisible padding or rules around it', () => {
  assert.match(timeline, /<DayLabel label=\{topDay\} onPick=\{pickDate\} float \/>/);
  assert.match(timeline, /className=\{float \? "nbm-day nbm-day-float" : "nbm-day"\}/);
  assert.match(css, /\.nbm-day-float\s*\{[^}]*padding:\s*0/);
  assert.match(css, /\.nbm-day-float \.nbm-day-rule\s*\{[^}]*display:\s*none/);
});

test('the open strip sits above the list (in flow), so it never covers the NEW line', () => {
  assert.match(css, /\.nbm-strip\s*\{(?![^}]*position:\s*absolute)[^}]*height:\s*36px/);
  assert.ok(timeline.indexOf('className="nbm-strip"') < timeline.indexOf('<MessageHistory'));
});

test('fold and menu agree on the same edge; header pieces in the mix', () => {
  assert.match(css, /@container conv \(width < 560px\)/);
  assert.match(view, /<ArrowRight \/> Open \{orgPlace\.title\} →/);
  assert.match(view, /<h1 className="nbm-chead-title truncate text-foreground group-hover\/title:underline">/);
  assert.match(css, /\.nbm-chead-title\s*\{[^}]*line-height:\s*1\.25|\.nbm-chead-title\s*\{[^}]*26px\/1\.25/);
  assert.match(view, /<div className="flex h-16 flex-none items-center gap-2 border-b border-border px-2 sm:px-3">\{backButton\}/);
  assert.match(skeleton, /flex h-10 flex-none items-end gap-4 border-b border-border px-4 pb-3 pointer-coarse:h-12/);
});
