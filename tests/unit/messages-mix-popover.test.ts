import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const suggest = readFileSync('src/components/messages/parts/SuggestList.tsx', 'utf8');
const mention = readFileSync('src/components/messages/parts/MentionDropdown.tsx', 'utf8');
const composer = readFileSync('src/components/messages/Composer.tsx', 'utf8');
const menu = readFileSync('src/components/messages/parts/ComposerMenu.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('slash, @mention, #channel and :emoji: lists share one popover with a mono key header', () => {
  for (const [name, src] of [['SuggestList', suggest], ['MentionDropdown', mention], ['Composer slash', composer]] as const) {
    assert.match(src, /nbm-popover/, name);
    assert.match(src, /className="nbm-popover-head"/, name);
    assert.match(src, /↑↓ move · ↵ pick · esc/, name);
    assert.match(src, /nbm-popover-row/, name);
  }
  assert.match(css, /\.nbm-popover\s*\{[^}]*border:\s*1px solid var\(--nbm-line\)[^}]*border-radius:\s*6px[^}]*var\(--nbm-shadow-pop\)/);
  assert.match(css, /\.nbm-popover-row\s*\{[^}]*min-height:\s*34px/);
  assert.match(css, /\.nbm-popover-row\[aria-selected="true"\][^{]*\{[^}]*var\(--nbm-soft\)/);
  assert.match(css, /\.nbm-popover-head\s*\{[^}]*var\(--nbm-mono\)[^}]*text-transform:\s*uppercase/);
});

test('the + and Schedule menus are Messages menus', () => {
  assert.match(menu, /<DropdownMenuContent side=\{side\} align=\{align\} className="nbm nbm-menu w-56">/);
});

test('the mention list also works outside Messages (update comments): its root carries .nbm for the tokens', () => {
  assert.match(mention, /<div className="nbm nbm-popover absolute bottom-full left-0 z-30 mb-1 w-64">/);
});
