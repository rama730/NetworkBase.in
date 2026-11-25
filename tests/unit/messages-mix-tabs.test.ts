import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const bar = readFileSync('src/components/messages/ChannelTabBar.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('tabs are mix tabs: 38px, clay 2px underline on the hairline, hover hairline grows from the centre', () => {
  assert.match(bar, /const tabClass = "nbm-tab/);
  assert.doesNotMatch(bar, /border-b-2|border-primary/);
  assert.match(css, /\.nbm-tab\s*\{[^}]*height:\s*38px/);
  assert.match(css, /\.nbm-tab::after\s*\{[^}]*height:\s*2px[^}]*background:\s*var\(--nbm-brand\)[^}]*transform:\s*scaleX\(0\)/);
  // The open tab's clay line is the shared sliding marker, never a second per-tab line.
  assert.match(bar, /<TabMarker overlap \/>/);
  assert.doesNotMatch(css, /\.nbm-tab\[aria-selected="true"\]::after/);
  assert.match(css, /\.nbm-tab:not\(\[aria-selected="true"\]\):hover::after\s*\{[^}]*background:\s*var\(--nbm-line\)/);
});

test('the Pins count is a padded mono chip capped at 99+, read as a number', () => {
  assert.match(bar, /<span className="nbm-count ml-1\.5"><span aria-hidden="true">\{padCount\(pinCount\)\}<\/span><span className="sr-only">\{pinCount\} pinned<\/span><\/span>/);
});
