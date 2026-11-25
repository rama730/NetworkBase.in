import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');
const launcher = readFileSync('src/components/messages/ChatLauncher.tsx', 'utf8');

test('switcher and New message rows stay 44px on touch; typed text keeps the ink colour', () => {
  assert.match(css, /@media \(pointer: coarse\) \{ \.nbm-sw-row \{ min-height: 44px; \} \}/);
  assert.doesNotMatch(css, /\.nbm-sw-find\s*\{[^}]*color:/);
});

test('launcher: one state (expanded), the rise listeners load with it, footer corners follow the dialog, one highlighted row', () => {
  assert.doesNotMatch(launcher, /aria-pressed/);
  assert.match(css, /\.nbm-launcher\[aria-expanded="true"\]/);
  assert.match(launcher, /import "@\/components\/messages\/recent-input";/);
  assert.match(css, /\.nbm-dialog \[data-slot="dialog-footer"\]\s*\{[^}]*border-radius:\s*0 0 7px 7px/);
  assert.match(css, /\.nbm-popover-row:not\(\.nbm-sw-row\):hover/);
});
