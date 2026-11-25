import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
});
const sources = files('src/components/messages').map((p) => [p, readFileSync(p, 'utf8')] as const);
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('every Messages dialog carries .nbm (portalled), and the plain ones the dialog grammar', () => {
  for (const [p, src] of sources) {
    for (const m of src.matchAll(/<DialogContent\b([^>]*)>/g)) {
      assert.match(m[1]!, /className="nbm[ "]/, `${p}: ${m[0].slice(0, 80)}`);
      if (!/presentation="bottom-sheet"|nbm-split/.test(m[1]!)) assert.match(m[1]!, /nbm-dialog/, `${p}: ${m[0].slice(0, 80)}`);
    }
  }
});

test('every Messages ConfirmDialog opts into the grammar', () => {
  for (const [p, src] of sources) {
    for (const m of src.matchAll(/<ConfirmDialog\b[\s\S]*?\/>/g)) assert.match(m[0], /contentClassName="nbm nbm-dialog"/, p);
  }
});

test('grammar: 8px corners, serif title, fg2 help line, paper footer strip', () => {
  assert.match(css, /\.nbm-dialog\s*\{[^}]*border-radius:\s*8px/);
  assert.match(css, /\.nbm-dialog \[data-slot="dialog-title"\]\s*\{[^}]*var\(--nbm-serif\)/);
  assert.match(css, /\.nbm-dialog \[data-slot="dialog-footer"\]\s*\{[^}]*background:\s*var\(--nbm-soft\)[^}]*border-top:\s*1px solid var\(--nbm-line\)/);
});

test('quick switcher: the find field is the head; mono group labels; square tags; soft active rows', () => {
  const sw = readFileSync('src/components/messages/QuickSwitcher.tsx', 'utf8');
  assert.match(sw, /<div className="nbm-sw-find">/);
  assert.match(sw, /className="nbm-glabel nbm-sw-group"/);
  assert.match(sw, /<span className="nbm-tag flex-none">Not joined<\/span>/);
  assert.match(sw, /<span className="nbm-tag flex-none">Can’t message<\/span>/);
  assert.match(sw, /className="nbm-popover-row nbm-sw-row" aria-selected|className="nbm-popover-row nbm-sw-row"/);
  assert.match(css, /\.nbm-sw-find\s*\{[^}]*height:\s*52px/);
});

test('shortcuts: groups as two-column key tables with kbd cells', () => {
  const sc = readFileSync('src/components/messages/ShortcutsDialog.tsx', 'utf8');
  assert.match(sc, /<h3 className="nbm-glabel mb-1\.5">/);
  assert.match(sc, /<dl className="nbm-keys">/);
  assert.match(sc, /<kbd className="nbm-kbd">\{keys\}<\/kbd>/);
  assert.match(css, /\.nbm-kbd\s*\{[^}]*border:\s*1px solid var\(--nbm-line\)[^}]*var\(--nbm-mono\)/);
});

test('new message: square To chips, a mono group label, the existing-conversation notice as a cell', () => {
  const nm = readFileSync('src/components/messages/NewMessage.tsx', 'utf8');
  assert.match(nm, /className="nbm-to-chip"/);
  assert.match(nm, /<p className="nbm-glabel px-2 py-1">/);
  assert.match(nm, /className=\{`nbm-popover-row nbm-sw-row\$\{index === activeIndex \? " is-active" : ""\}`\}/);
  assert.match(nm, /<span className="nbm-tag flex-none">Can’t message<\/span>/);
  assert.match(nm, /<p className="nbm-notice">/);
  assert.match(css, /\.nbm-to-chip\s*\{[^}]*border-radius:\s*3px/);
});

test('launcher: a 56px square cell, mono count chip, open = ink fill (pressed); it carries .nbm itself', () => {
  const l = readFileSync('src/components/messages/ChatLauncher.tsx', 'utf8');
  assert.match(l, /className="nbm nbm-launcher fixed bottom-6 right-6 z-20"/);
  assert.match(l, /aria-pressed=\{open\}/);
  assert.match(l, /<span className="nbm-count hot nbm-launcher-count" aria-hidden="true">\{padCount\(badge\)\}<\/span>/);
  assert.match(css, /\.nbm-launcher\s*\{[^}]*width:\s*56px[^}]*height:\s*56px[^}]*border-radius:\s*6px/);
  assert.match(css, /\.nbm-launcher\[aria-pressed="true"\]\s*\{[^}]*var\(--nbm-ink\)/);
});

test('window: 8px corners, header cells, rises 12px in 220ms only after an interaction', () => {
  const w = readFileSync('src/components/messages/ChatWindow.tsx', 'utf8');
  assert.match(w, /nbm-window/);
  assert.match(w, /const \[rise\] = useState\(recentInput\)/);
  assert.match(w, /rise \? " nbm-window-rise" : ""/);
  assert.doesNotMatch(w, /nb-icon-button/);
  assert.match(css, /\.nbm-window\s*\{[^}]*border-radius:\s*8px/);
  assert.match(css, /@keyframes nbm-window-rise \{ from \{ opacity: 0; transform: translateY\(12px\); \}/);
  assert.match(css, /\.nbm-window-rise\s*\{[^}]*animation:\s*nbm-window-rise 220ms/);
});
