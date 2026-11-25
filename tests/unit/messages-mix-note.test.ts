import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const canvas = readFileSync('src/components/messages/ChannelCanvas.tsx', 'utf8');
const editor = readFileSync('src/components/messages/CanvasEditor.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('note tab: 720px page, serif title, mono save tag (red when not saved), cells and Messages menus', () => {
  assert.match(canvas, /className="nbm-note"/);
  assert.match(canvas, /className="nbm-note-title"/);
  assert.match(canvas, /className=\{`nbm-tag \$\{status === "error" \? "bad" : ""\}/);
  assert.match(canvas, /className="nbm-note-copy"/);
  assert.match(canvas, /<DropdownMenuTrigger className="nbm-cell nb-touch-target" aria-label="More note options">/);
  assert.match(canvas, /<DropdownMenuContent align="end" className="nbm nbm-menu w-52">/);
  assert.match(canvas, /<div role="alert" className="nbm-warn">/);
  assert.match(canvas, /Someone else saved first\. Copy your version to add it back\./);
  assert.match(css, /\.nbm-note\s*\{[^}]*max-width:\s*720px/);
  assert.match(css, /\.nbm-note-title\s*\{[^}]*var\(--nbm-serif\)/);
});

test('template tray as cells; the block menu is a Messages menu', () => {
  assert.match(canvas, /className="nbm-note-tray"/);
  assert.match(canvas, /className="nbm-tray-cell"/);
  assert.doesNotMatch(editor, /<DropdownMenuContent(?![^>]*nbm-menu)[^>]*>/);
});
