import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { averageGrid, peaksFrom } from '../../src/lib/messaging/media-make';

test('averageGrid: a 24×24 RGBA image of two halves → 12×12 hex cells, left red, right blue', () => {
  const w = 24, h = 24, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    px.set(x < 12 ? [255, 0, 0, 255] : [0, 0, 255, 255], i);
  }
  const hex = averageGrid(px, w, h, 12);
  assert.equal(hex.length, 864);
  assert.equal(hex.slice(0, 6), 'ff0000');
  assert.equal(hex.slice(66, 72), '0000ff');
});

test('peaksFrom: 48 bars scaled to the loudest, 0–100', () => {
  const samples = new Float32Array(4800).map((_, i) => (i < 2400 ? 0.5 : -1));
  const peaks = peaksFrom(samples, 48);
  assert.equal(peaks.length, 48);
  assert.equal(peaks[0], 50);
  assert.equal(peaks[47], 100);
  assert.deepEqual(peaksFrom(new Float32Array(0), 48), []);
  assert.ok(peaksFrom(new Float32Array(100), 48).every((p) => p === 0));
});

test('the Composer makes extras at upload and sends them with the files (never blocking)', () => {
  const composer = readFileSync('src/components/messages/Composer.tsx', 'utf8');
  assert.match(composer, /makeMediaExtras\(file\)/);
  assert.match(composer, /const media = Object\.fromEntries\(ready\.filter\(\(u\) => u\.extras\)\.map\(\(u\) => \[u\.assetId!, u\.extras!\]\)\)/);
  assert.match(composer, /sendMessage\(\{ channelId, body, clientId, threadRootSeq, assetIds, media, alsoToChannel: sentAlso \}\)/);
});
