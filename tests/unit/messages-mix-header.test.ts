import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { capCount } from '../../src/lib/messaging/mix-format';

const view = readFileSync('src/components/messages/ConversationView.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('the conversation is a size container and the header is the 64px mix header', () => {
  assert.match(view, /className="nbm-conv flex h-full min-h-0 flex-col bg-card"/);
  assert.match(view, /<header className="nbm-chead">/);
  assert.match(css, /\.nbm-conv\s*\{[^}]*container:\s*conv \/ inline-size/);
  assert.match(css, /\.nbm-chead\s*\{[^}]*height:\s*64px/);
  assert.match(css, /\.nbm-chead-title\s*\{[^}]*var\(--nbm-serif\)[^}]*26px|\.nbm-chead-title\s*\{[^}]*26px[^}]*var\(--nbm-serif\)/);
});

test('header cells fold by the column (under 560px), not the window', () => {
  assert.doesNotMatch(view, /hidden sm:inline-flex|className="sm:hidden"/);
  assert.match(css, /@container conv \(max-width: 559px\)\s*\{\s*\.nbm-fold,[^{]*\{\s*display:\s*none/);
  // The ⋯ menu gets what folded: search, notifications and the org link.
  assert.match(view, /const \[convRef, narrow\] = useNarrow\(560\)/);
  assert.match(view, /\{narrow && orgPlace \? <DropdownMenuItem asChild><Link href=\{orgPlace\.href\}>/);
});

test('members cell: faces and a capped mono count', () => {
  assert.match(view, /className="nbm-faces"/);
  assert.match(view, /capCount\(channel\.member_count, 999\)/);
  assert.equal(capCount(1284, 999), '999+');
});
