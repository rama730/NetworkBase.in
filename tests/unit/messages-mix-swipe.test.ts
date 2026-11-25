import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const sections = readFileSync('src/components/messages/ChatSections.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('swipe cells are square: Read = ink, Mute = soft, Close/Star = clay', () => {
  assert.match(sections, /Read: "nbm-swipe-ink"/);
  assert.match(sections, /Mute: "nbm-swipe-soft", Unmute: "nbm-swipe-soft"/);
  assert.match(sections, /tones\[label\] \?\? "nbm-swipe-clay"/);
  for (const tone of ['ink', 'soft', 'clay']) assert.match(css, new RegExp(`\\.nbm-swipe-${tone}\\s*\\{`), tone);
  assert.match(css, /\.nbm \.nb-chat-swipe\s*\{[^}]*border-radius:\s*0/);
  assert.match(css, /\.nbm \.nb-chat-swipe-actions > button\s*\{[^}]*font:[^;]*var\(--nbm-mono\)[^}]*text-transform:\s*uppercase/);
});

test('list rows with a preview are 60px with a mono time', () => {
  assert.match(css, /\.nbm \.nb-chat-row-preview\s*\{[^}]*min-height:\s*60px/);
  assert.match(css, /\.nbm \.nb-chat-row-preview \.nb-meta\s*\{[^}]*var\(--nbm-mono\)/);
});
