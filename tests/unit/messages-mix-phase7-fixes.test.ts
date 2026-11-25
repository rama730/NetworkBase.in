import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const view = readFileSync('src/components/messages/parts/FilesView.tsx', 'utf8');
const action = readFileSync('src/app/actions/chat/messages.ts', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('the note column never grows past 720 (a long link wraps, nothing is cut)', () => {
  assert.match(css, /\.nbm-note\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test('Back closes the Photos viewer first; a failed page says so with Retry', () => {
  assert.match(view, /useOverlayHistory\("media", open !== null, \(\) => setOpen\(null\)\)/);
  assert.match(view, /media\.isFetchNextPageError \? <ErrorNotice what="Older photos"/);
});

test('the save tag truncates; the conflict strip wraps', () => {
  assert.match(css, /\.nbm-note-bar \.nbm-tag\s*\{[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/);
  assert.match(css, /\.nbm-note-conflict\s*\{[^}]*flex-wrap:\s*wrap/);
});

test('small fixes: roving List | Photos, 44px Download, no dead last click, safe cursor, thumbnails, video words', () => {
  assert.match(view, /tabIndex=\{view === value \? 0 : -1\}/);
  assert.match(view, /className="nbm-cell nb-touch-target flex-none"/);
  assert.match(action, /LIMIT \$\{limit \+ 1\}/);
  assert.match(action, /Number\.isSafeInteger\(input\.before\.seq\) && input\.before\.seq >= 0/);
  assert.match(view, /thumbnailUrl: file\.mime\.startsWith\("image\/"\)/);
  assert.match(view, /file\.mime\.startsWith\("video\/"\) \? "video" : "photo"/);
});
