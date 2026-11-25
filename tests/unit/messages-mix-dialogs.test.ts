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
