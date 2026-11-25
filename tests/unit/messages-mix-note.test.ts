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

test('templates and copy-from: list + preview split in the mix; selected = card fill, never clay', () => {
  for (const f of ['src/components/messages/CanvasTemplateModal.tsx', 'src/components/messages/ExistingCanvasModal.tsx']) {
    const src = readFileSync(f, 'utf8');
    assert.match(src, /<DialogContent size="wide" showCloseButton=\{false\} className="nbm nbm-split /, f);
    assert.match(src, /className="nbm-split-row"/, f);
    assert.match(src, /aria-label="Close dialog" className="nbm-cell nb-touch-target/, f);
  }
  assert.match(readFileSync('src/components/messages/CanvasTemplateModal.tsx', 'utf8'), /<p className="nbm-glabel px-2\.5 pb-1 pt-1\.5"><span>\{category\}<\/span>/);
  assert.match(readFileSync('src/components/messages/CanvasTemplateModal.tsx', 'utf8'), /<h1 className="nbm-split-title">/);
  assert.match(css, /\.nbm-split-row\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--card\)/);
});
