import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const row = readFileSync('src/components/messages/MessageRow.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('row shell: nbm-msg with grouped and mention flags; the jump target flashes clay for 2.5 s', () => {
  assert.match(row, /className=\{`nbm-msg group\/msg relative outline-none \[-webkit-touch-callout:none\]\$\{highlighted \? " nbm-flash" : ""\}`\}/);
  assert.match(row, /data-grouped=\{grouped \? "true" : undefined\}/);
  assert.match(row, /data-mention=\{mentioned \? "true" : undefined\}/);
  assert.match(css, /\.nbm-msg\s*\{[^}]*padding:\s*8px 20px 4px/);
  assert.match(css, /\.nbm-msg\[data-grouped="true"\]\s*\{[^}]*padding-top:\s*1px/);
  assert.match(css, /\.nbm-msg:hover, \.nbm-msg:focus-within\s*\{[^}]*background(-color)?:\s*var\(--card\)/);
  // A mention keeps its warm fill on hover (hover never imitates it).
  assert.match(css, /\.nbm-msg\[data-mention="true"\], \.nbm-msg\[data-mention="true"\]:hover, \.nbm-msg\[data-mention="true"\]:focus-within\s*\{[^}]*var\(--nbm-hl\)/);
});

test('flags are mono capitals above the name, Saved in clay, no icons', () => {
  assert.match(row, /<p className="nbm-flags">/);
  assert.match(row, /<span className="nbm-flags-saved">Saved<\/span>/);
  assert.match(css, /\.nbm-flags\s*\{[^}]*var\(--nbm-mono\)[^}]*text-transform:\s*uppercase/);
  assert.match(css, /\.nbm-flags-saved\s*\{[^}]*var\(--nbm-brand\)/);
});

test('name 14/600, mono time, mono (edited), Sending… with the pixel beat, 36px gutter', () => {
  assert.match(row, /className="nbm-msg-name/);
  assert.match(row, /className="nbm-msg-time/);
  assert.match(row, /<span className="nbm-msg-sending" aria-hidden="true"><PixelBeat \/>Sending…<\/span>/);
  assert.match(row, /className="nbm-edited"/);
  assert.match(row, /<UserAvatar identity=\{message\.author\} size=\{36\} \/>/);
  assert.match(css, /\.nbm-msg-name\s*\{[^}]*font-size:\s*14px[^}]*font-weight:\s*600/);
  assert.match(css, /\.nbm-msg-gutter\s*\{[^}]*width:\s*36px/);
});

test('after the flash ends the row keeps its own fill (hover, mention): no "both" fill on rows', () => {
  assert.match(css, /\.nbm-msg\.nbm-flash\s*\{[^}]*animation-fill-mode:\s*backwards/);
});

test('reactions: square cells with a mono count; yours clay; a new one pops (not the ones already there)', () => {
  assert.match(row, /className=\{`nbm-rc\$\{pop \? " nbm-pop" : ""\}`\}/);
  assert.match(row, /data-me=\{me \? "true" : undefined\}/);
  assert.match(row, /pop=\{!seenReactions\.current\.has\(r\.emoji\)\}/);
  assert.match(css, /\.nbm-rc\s*\{[^}]*height:\s*24px[^}]*border-radius:\s*3px[^}]*var\(--nbm-mono\)/);
  assert.match(css, /\.nbm-rc\[data-me="true"\]\s*\{[^}]*border-color:\s*var\(--nbm-brand\)[^}]*background:\s*var\(--nbm-tint\)/);
});

test('thread link: clay count, mono last reply, hover outline', () => {
  assert.match(row, /className="nbm-thr"/);
  assert.match(row, /<b>\{message\.reply_count\} \{message\.reply_count === 1 \? "reply" : "replies"\}<\/b>/);
  assert.match(css, /\.nbm-thr:hover\s*\{[^}]*border-color:\s*var\(--nbm-line\)/);
});

test('hover toolbar: one strip of 32px cells split by hairlines; menus are Messages menus', () => {
  assert.match(row, /nbm-bar pointer-coarse:!hidden/);
  assert.doesNotMatch(row, /className="nb-icon-button size-8"/);
  assert.match(css, /\.nbm-bar > button\s*\{[^}]*width:\s*32px[^}]*border-right:\s*1px solid var\(--nbm-line\)/);
  assert.match(row, /<DropdownMenuContent align="end" side="bottom" sideOffset=\{4\} className="nbm nbm-menu min-w-\[210px\]">/);
  assert.match(row, /<DropdownMenuSubContent className="nbm nbm-menu w-48">/);
});
