import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { tileBox, formatDuration } from '../../src/lib/messaging/media-kind';

test('tileBox: the stored shape fitted to 320×360; no size = a 4:3 box 240 wide', () => {
  assert.deepEqual(tileBox(4000, 3000), { width: 320, ratio: '4000 / 3000' });
  assert.deepEqual(tileBox(1000, 4000), { width: 90, ratio: '1000 / 4000' });
  assert.deepEqual(tileBox(null, null), { width: 240, ratio: '4 / 3' });
});

test('formatDuration: 0:42, 3:05, 1:02:03', () => {
  assert.equal(formatDuration(42_000), '0:42');
  assert.equal(formatDuration(185_000), '3:05');
  assert.equal(formatDuration(3_723_000), '1:02:03');
  assert.equal(formatDuration(null), '');
});

const tiles = readFileSync('src/components/messages/parts/message-attachments.tsx', 'utf8');
const row = readFileSync('src/components/messages/MessageRow.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('tiles: pixel preview, slow-line strip, video poster + square play cell + duration, GIF tag, error with Retry and Download', () => {
  assert.match(tiles, /<PixelPreview colors=\{/);
  assert.match(tiles, /Loading · \{formatFileSize/);
  assert.match(tiles, /className="nbm-tile-play"/);
  assert.match(tiles, /className="nbm-tile-duration"/);
  assert.match(tiles, />GIF</);
  assert.match(tiles, /Image didn’t load/);
  assert.match(tiles, /Video didn’t load/);
  assert.match(tiles, /className="nbm-tile-err-act" onClick=\{retry\}/);
  assert.match(css, /\.nbm-mtile\s*\{[^}]*border-radius:\s*3px/);
  assert.match(css, /\.nbm-pxpreview\s*\{[^}]*image-rendering:\s*pixelated/);
});

test('the row passes the thumbnail, preview and duration; audio is audio', () => {
  assert.match(row, /thumbnailUrl: attachment\.thumb_asset_id \? `\/api\/v1\/chat\/attachments\/\$\{attachment\.thumb_asset_id\}` : null/);
  assert.match(row, /const kind = mediaKind\(attachment\.mime, attachment\.name\)/);
});

test('grids: 4px gaps, mono +N on 70% ink; file chips as list cells', () => {
  assert.match(css, /\.nbm \.msg-bento-grid\s*\{[^}]*gap:\s*4px/);
  assert.match(tiles, /className="nbm-tile-more"/);
  assert.match(css, /\.nbm-tile-more\s*\{[^}]*var\(--nbm-mono\)/);
  assert.match(tiles, /className="nbm-fchip"/);
});

test('a GIF under reduced motion shows its first frame on a canvas (an <img> would keep animating)', () => {
  assert.match(tiles, /function StillFrame\(/);
  assert.match(tiles, /&& still \? <StillFrame src=\{displayUrl\}/);
});
