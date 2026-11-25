import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { clampZoom, viewerLabel, viewerMeta } from '../../src/lib/messaging/viewer';

test('zoom stays 100–400 %; the dialog says which file of how many; the mono meta line', () => {
  assert.equal(clampZoom(0.5), 1);
  assert.equal(clampZoom(2.345), 2.35);
  assert.equal(clampZoom(9), 4);
  assert.equal(viewerLabel('photo.jpg', 1, 5), 'Media viewer: photo.jpg, 2 of 5');
  assert.equal(viewerLabel('photo.jpg', 0, 1), 'Media viewer: photo.jpg');
  assert.equal(viewerMeta({ index: 1, count: 5, name: 'a.jpg', size: 2_400_000, width: 3024, height: 4032, formatSize: () => '2.3 MB' }), '2 / 5 · JPG · 2.3 MB · 3024 × 4032');
});

const viewer = readFileSync('src/components/ui/media-viewer.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('the viewer is a real dialog on the ink stage with cell chrome; no round buttons', () => {
  assert.match(viewer, /role="dialog"/);
  assert.match(viewer, /aria-modal="true"/);
  assert.match(viewer, /aria-label=\{viewerLabel\(/);
  assert.doesNotMatch(viewer, /rounded-full/);
  assert.match(viewer, /cn\('nbm nbm-viewer'/);
  assert.match(css, /\.nbm-viewer\s*\{[^}]*background:\s*var\(--nbm-stage\)/);
});

test('zoom cells, Fit and 1:1, an error card with Retry, a filmstrip with mono index, an Info panel, keys', () => {
  assert.match(viewer, />Fit</);
  assert.match(viewer, />1:1</);
  assert.match(viewer, /This image didn’t load\./);
  assert.match(viewer, /className="nbm-viewer-strip"/);
  assert.match(viewer, /aria-label="Info"/);
  assert.match(viewer, /event\.key === 'i'/);
  assert.match(viewer, /url=\{currentAttachment\.localUrl \|\| currentAttachment\.url\}/);
});
