import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { previewCanvasSize } from '../../src/lib/messaging/media-kind';

// Images loading blank (2026-11-26): photos sent before 0149 have no pixel preview, and a quick send could skip it.
const src = (path: string) => readFileSync(path, 'utf8');

test('the viewer paints the pixel preview at the photo’s own shape, not a square', () => {
  assert.deepEqual(previewCanvasSize(1920, 1200), { width: 48, height: 30 });
  assert.deepEqual(previewCanvasSize(1440, 1920), { width: 36, height: 48 });
  assert.deepEqual(previewCanvasSize(null, null), { width: 48, height: 48 }, 'no stored size: square');
  assert.deepEqual(previewCanvasSize(4000, 10), { width: 48, height: 1 }, 'never zero');
  const viewer = src('src/components/ui/media-viewer.tsx');
  assert.match(viewer, /previewCanvasSize\(currentAttachment\.width, currentAttachment\.height\)/);
});

test('a photo with no pixel preview shows the pixel beat and its size at once, never a blank box', () => {
  const tiles = src('src/components/messages/parts/message-attachments.tsx');
  assert.match(tiles, /className="nbm-mtile-wait"/);
  assert.match(tiles, /!colors && !loaded && !hasError && displayUrl/);
  assert.match(src('src/components/messages/messages-mix.css'), /\.nbm-mtile-wait \{/);
});

test('the viewer says Loading at once when it has nothing to paint while the photo loads', () => {
  assert.match(src('src/components/ui/media-viewer.tsx'), /\(slow \|\| \(!colors && !placeholderUrl\)\) && !isMediaLoaded && !failed/);
});

test('sending waits for the pixel preview and thumbnail being made, so a quick send still stores them', () => {
  const composer = src('src/components/messages/Composer.tsx');
  assert.match(composer, /uploads\.some\(\(u\) => !u\.assetId \|\| u\.making\)/);
  assert.match(composer, /const uploading = uploads\.filter\(\(u\) => \(!u\.assetId \|\| u\.making\) && !u\.error\)/);
  assert.match(composer, /making: false/);
});
