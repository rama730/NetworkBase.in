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
