import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { claimSound, nextSpeed } from '../../src/lib/messaging/one-sound';

test('one sound at a time: claiming a new player pauses the one before', () => {
  const paused: string[] = [];
  const a = { pause: () => paused.push('a') }, b = { pause: () => paused.push('b') };
  claimSound(a);
  claimSound(b);
  claimSound(b);
  assert.deepEqual(paused, ['a']);
});

test('speed cycles 1 → 1.5 → 2 → 0.75 → 1', () => {
  assert.equal(nextSpeed(1), 1.5);
  assert.equal(nextSpeed(1.5), 2);
  assert.equal(nextSpeed(2), 0.75);
  assert.equal(nextSpeed(0.75), 1);
  assert.equal(nextSpeed(3), 1);
});

const tile = readFileSync('src/components/messages/parts/AudioTile.tsx', 'utf8');
const list = readFileSync('src/components/messages/parts/message-attachments.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('audio tile: play cell, waveform scrubber (a slider), mono time, speed cell, error with Retry', () => {
  assert.match(tile, /role="slider"/);
  assert.match(tile, /aria-valuetext=\{`\$\{formatDuration\(current\)\} of \$\{formatDuration\(total\)\}`\}/);
  assert.match(tile, /Audio didn’t load/);
  assert.match(tile, /claimSound\(audio\)/);
  assert.match(list, /<AudioTile key=\{attachment\.id\} attachment=\{attachment\} \/>/);
  assert.match(css, /\.nbm-audio-bar\[data-played="true"\]\s*\{[^}]*var\(--nbm-ink\)/);
});
