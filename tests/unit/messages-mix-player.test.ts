import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { readPlayerPrefs, writePlayerPrefs, PLAYER_SPEEDS } from '../../src/lib/messaging/player-prefs';

test('player prefs: defaults, clamped values, a storage that throws', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.deepEqual(readPlayerPrefs(storage), { volume: 1, speed: 1 });
  writePlayerPrefs(storage, { volume: 0.4, speed: 1.5 });
  assert.deepEqual(readPlayerPrefs(storage), { volume: 0.4, speed: 1.5 });
  store.set('nb-player', JSON.stringify({ volume: 9, speed: 7 }));
  assert.deepEqual(readPlayerPrefs(storage), { volume: 1, speed: 1 });
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(readPlayerPrefs(broken), { volume: 1, speed: 1 });
  assert.doesNotThrow(() => writePlayerPrefs(broken, { volume: 1, speed: 1 }));
  assert.deepEqual([...PLAYER_SPEEDS], [0.75, 1, 1.25, 1.5, 2]);
});

const bar = readFileSync('src/components/messages/parts/MixPlayerBar.tsx', 'utf8');
const viewer = readFileSync('src/components/ui/media-viewer.tsx', 'utf8');
const tiles = readFileSync('src/components/messages/parts/message-attachments.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('one mix player: cells, a scrubber slider, mono time, speed cells, loop, PiP, fullscreen, keys', () => {
  assert.match(bar, /role="slider"/);
  assert.match(bar, /label="Speed"/);
  assert.match(bar, /aria-label="Picture in picture"/);
  assert.match(bar, /aria-label=\{fullscreen \? "Exit full screen" : "Full screen"\}/);
  assert.match(bar, /case "j":|"j"/);
  assert.match(css, /\.nbm-pbar\s*\{/);
  assert.match(css, /\.nbm-pbar-thumb\s*\{[^}]*width:\s*10px[^}]*height:\s*10px/);
});

test('the viewer uses the mix player (no native controls); tiles can play inline', () => {
  assert.doesNotMatch(viewer, /controls=\{true\}/);
  assert.match(viewer, /<MixPlayerBar /);
  assert.match(tiles, /<MixPlayerBar compact /);
});
