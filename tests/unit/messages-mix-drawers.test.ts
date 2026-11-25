import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const drawer = readFileSync('src/components/messages/ChatDrawer.tsx', 'utf8');
const thread = readFileSync('src/components/messages/ThreadPane.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('drawer chrome: 64px header, serif title, mono where-line, square cells, slides in', () => {
  assert.match(drawer, /<header className="nbm-dhead">/);
  assert.match(drawer, /className="nbm-dhead-title outline-none"/);
  assert.match(drawer, /className="nbm-dhead-where/);
  assert.match(drawer, /nbm-enter-slide/);
  assert.match(drawer, /className="nbm-cell nb-touch-target" aria-label=\{`Close \$\{label\.toLowerCase\(\)\}`\}/);
  assert.match(css, /\.nbm-dhead\s*\{[^}]*height:\s*64px/);
  assert.match(css, /\.nbm-dhead-title\s*\{[^}]*var\(--nbm-serif\)/);
});

test('Thread | Details tabs are mix tabs under the shared marker; the panel crossfades', () => {
  assert.match(drawer, /className="nbm-tab capitalize"/);
  assert.match(drawer, /<TabMarker \/>/);
  assert.match(drawer, /key=\{active\} className="nbm-fade-in flex min-h-0 flex-1 flex-col"|nbm-fade-in/);
});

test('Follow is a toggle cell: Following = ink fill + tick', () => {
  assert.match(thread, /className="nbm-follow"/);
  assert.match(css, /\.nbm-follow\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--nbm-ink\)[^}]*color:\s*var\(--nbm-on-ink\)/);
  assert.match(thread, /<DropdownMenuTrigger className="nbm-cell nb-touch-target flex-none" aria-label="Thread options">/);
  assert.match(thread, /<DropdownMenuContent align="end" className="nbm nbm-menu w-52">/);
});

test('thread content: mix skeleton, quiet load buttons, mono replies label with a rule, footer cell', () => {
  assert.doesNotMatch(thread, /<Skeleton\b/);
  assert.match(thread, /className="nbm-sk/);
  assert.equal((thread.match(/className="nbm-loadmore"/g) ?? []).length, 2);
  assert.match(thread, /<div className="nbm-thr-label">/);
  assert.match(thread, /<div className="nbm-comp-foot"><div className="nbm-comp-foot-cell">\s*\{details\.data\.channel_archived_at/);
  assert.match(css, /\.nbm-thr-label\s*\{[^}]*var\(--nbm-mono\)[^}]*text-transform:\s*uppercase/);
});
