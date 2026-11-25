import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const d = readFileSync('src/components/messages/DetailsPane.tsx', 'utf8');
const drawer = readFileSync('src/components/messages/ChatDrawer.tsx', 'utf8');
const add = readFileSync('src/components/messages/parts/AddPeople.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('notification radios check the pick at once (optimistic) and take ↑/↓ like native radios', () => {
  assert.match(d, /const \[pending, setPending\] = useState<string \| null>\(null\)/);
  assert.match(d, /const current = pending \?\? notifyChoice\(channel, channel\.notify\)/);
  assert.match(d, /event\.key === "ArrowDown" \? "ArrowRight" : event\.key === "ArrowUp" \? "ArrowLeft"/);
});

test('the notification cells stay their own size (no stretched box)', () => {
  assert.match(css, /\.nbm-drow \.nbm-seg-wrap\s*\{\s*display:\s*inline-flex;\s*max-width:\s*100%;\s*margin-top:\s*8px;\s*\}/);
});

test('links keep their colour; motion only after an interaction; touch tabs 44px; no doubled last line', () => {
  assert.match(css, /\.nbm-drow-side:is\(a\)\s*\{[^}]*color:\s*var\(--nbm-brand\)/);
  assert.match(css, /\.nbm-dhead-where:is\(a\):hover\s*\{[^}]*color:\s*var\(--foreground\)/);
  assert.match(drawer, /const \[slide\] = useState\(\(\) => Date\.now\(\) - lastInputAt < 1000\)/);
  assert.match(css, /@media \(pointer: coarse\) \{ \.nbm-tab \{ min-height: 44px; \} \}/);
  assert.match(css, /\.nbm-drow:last-child\s*\{\s*border-bottom:\s*0/);
  assert.match(css, /\.nbm-qa > :focus-visible, \.nbm-seg > button:focus-visible\s*\{[^}]*outline-offset:\s*-2px/);
});

test('plan gaps: single-line values sit right of their label; one quick strip in the DM view; member menu and status line in the mix; Add people rows', () => {
  assert.match(d, /\{draft === null && !multiline \? valueView\("nbm-drow-side"\) : null\}/);
  assert.match(d, /<QuickActions channel=\{channel\} onStar=\{\(\) => setState\(\{ starred: !channel\.starred \}\)\} lead=/);
  assert.match(d, /<DropdownMenuContent align="end" className="nbm nbm-menu w-48">/);
  assert.match(d, /<span className="nbm-lrow-meta block truncate">\{presence\.statusText/);
  assert.match(add, /className="nbm-mrow nbm-mrow-add"/);
});
