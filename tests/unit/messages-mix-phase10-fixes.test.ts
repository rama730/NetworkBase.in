import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { tileRetryUrl } from '../../src/lib/messaging/media-kind';
import { AUDIO_EXTRAS_MAX, isAbortError } from '../../src/lib/messaging/media-make';

const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');
const tiles = readFileSync('src/components/messages/parts/message-attachments.tsx', 'utf8');
const viewer = readFileSync('src/components/ui/media-viewer.tsx', 'utf8');
const audio = readFileSync('src/components/messages/parts/AudioTile.tsx', 'utf8');
const make = readFileSync('src/lib/messaging/media-make.ts', 'utf8');
const migration = readFileSync('drizzle/0149_chat_attachment_media.sql', 'utf8');

test('the video play cell takes clicks above the open-viewer hit area', () => {
  assert.match(css, /\.nbm-tile-play\[type\][^{]*\{[^}]*pointer-events:\s*auto[^}]*z-index:\s*11/);
});

test('Retry re-asks for the tile picture (thumb first), never the full original', () => {
  assert.equal(tileRetryUrl('/api/v1/chat/attachments/11111111-1111-1111-1111-111111111111', 2, 5), '/api/v1/chat/attachments/11111111-1111-1111-1111-111111111111?_reauth=5');
  assert.equal(tileRetryUrl('blob:x', 2, 5), 'blob:x');
  assert.equal(tileRetryUrl('https://cdn.test/a.webp?x=1', 3, 5), 'https://cdn.test/a.webp?x=1&retry=3');
  assert.match(tiles, /tileRetryUrl\(previewUrl/);
  assert.doesNotMatch(tiles, /attachmentRetryUrl\(attachment\.url, attempt \+ 1\)/);
});

test('a video whose poster fails is a glyph tile that still plays, not an error', () => {
  assert.match(tiles, /setPosterFailed\(true\)/);
  assert.match(tiles, /posterFailed \? null/);
});

test('the viewer player bar remounts with each item', () => {
  assert.match(viewer, /<MixPlayerBar key=\{currentAttachment\.id\}/);
});

test('viewer keys leave buttons, links and radio cells alone; the trap pulls stray focus back', () => {
  assert.match(viewer, /event\.key === ' ' && target\?\.closest\('button, a'\)/);
  assert.match(viewer, /event\.key\.startsWith\('Arrow'\) && target\?\.closest\('\[role="radio"\], \[role="radiogroup"\]'\)/);
  assert.match(viewer, /event\.defaultPrevented/);
  assert.match(viewer, /!dialogRef\.current\?\.contains\(document\.activeElement\)/);
});

test('audio extras: small files only, decoded at 8 kHz mono, with a time limit', () => {
  assert.equal(AUDIO_EXTRAS_MAX, 15_000_000);
  assert.match(make, /new OfflineCtx\(1, 1, 8000\)/);
  assert.match(make, /withTimeout\(/);
});

test('a play() that another tile cut short is not "Audio didn’t load"', () => {
  assert.equal(isAbortError(new DOMException('x', 'AbortError')), true);
  assert.equal(isAbortError(new Error('boom')), false);
  assert.match(audio, /if \(!isAbortError\(error\)\) setFailed\(true\)/);
});

test('0149 gives up rather than block sends while it takes its locks', () => {
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
});
