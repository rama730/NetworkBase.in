import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mediaKind, parsePreview, cleanMediaExtras } from '../../src/lib/messaging/media-kind';

test('mediaKind: audio is audio (an .ogg voice note is not a video)', () => {
  assert.equal(mediaKind('audio/ogg', 'note.ogg'), 'audio');
  assert.equal(mediaKind('application/octet-stream', 'note.ogg'), 'audio');
  assert.equal(mediaKind('', 'voice.opus'), 'audio');
  assert.equal(mediaKind('audio/mpeg', 'song.mp3'), 'audio');
  assert.equal(mediaKind('video/ogg', 'clip.ogv'), 'video');
  assert.equal(mediaKind('', 'clip.webm'), 'video');
  assert.equal(mediaKind('image/png', 'a.png'), 'image');
  assert.equal(mediaKind('application/pdf', 'a.pdf'), 'file');
});

test('parsePreview: 864 hex chars → 144 colours, anything else → null', () => {
  assert.equal(parsePreview('ff0000'.repeat(144))!.length, 144);
  assert.equal(parsePreview('ff0000'.repeat(144))![0], '#ff0000');
  assert.equal(parsePreview('zz'), null);
  assert.equal(parsePreview(null), null);
});

test('cleanMediaExtras keeps only well-formed extras', () => {
  assert.deepEqual(cleanMediaExtras({ preview: 'ab'.repeat(432), durationMs: 42000, peaks: [0, 50, 100] }), { preview: 'ab'.repeat(432), durationMs: 42000, peaks: [0, 50, 100] });
  assert.deepEqual(cleanMediaExtras({ preview: 'nope', durationMs: -1, peaks: Array(49).fill(1) }), { preview: null, durationMs: null, peaks: null });
  assert.deepEqual(cleanMediaExtras({ peaks: [0, 101] }), { preview: null, durationMs: null, peaks: null });
});

const migration = readFileSync('drizzle/0149_chat_attachment_media.sql', 'utf8');
const send = readFileSync('src/lib/messaging/send.ts', 'utf8');
const route = readFileSync('src/app/api/v1/chat/attachments/[assetId]/route.ts', 'utf8');
const queries = readFileSync('src/lib/messaging/queries.ts', 'utf8');

test('migration: nullable columns with checks, an index for thumbnails', () => {
  assert.match(migration, /ADD COLUMN thumb_asset_id uuid/);
  assert.match(migration, /preview ~ '\^\[0-9a-f\]\{864\}\$'/);
  assert.match(migration, /cardinality\(peaks\) <= 48/);
  assert.match(migration, /CREATE INDEX chat_attachments_thumb_idx/);
});

test('send writes extras only with the sender’s own verified thumbnail; the route serves thumbnails to members', () => {
  assert.match(send, /UPDATE chat_attachments/);
  assert.match(send, /owner_user_id = \$\{user\.id\}::uuid AND state = 'verified' AND bucket = 'chat-attachments'/);
  assert.match(route, /ca\.thumb_asset_id = a\.id AND app_private\.chat_is_member\(ca\.channel_id/);
  assert.match(queries, /'thumb_asset_id', a\.thumb_asset_id, 'preview', a\.preview, 'duration_ms', a\.duration_ms, 'peaks', a\.peaks/);
});
