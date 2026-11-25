import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const files = readFileSync('src/components/messages/parts/FilesView.tsx', 'utf8');
const view = readFileSync('src/components/messages/ConversationView.tsx', 'utf8');
const skel = readFileSync('src/components/messages/parts/RowsSkeleton.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('pins and files are list cells with mono meta and action cells', () => {
  assert.match(files, /className="nbm-lrow"/);
  assert.match(view, /<li className="nbm-lrow nbm-lrow-top">/);
  assert.match(files, /className="nbm-lrow-meta /);
  assert.match(view, /<time dateTime=\{message\.created_at\} className="nbm-lrow-meta"/);
  assert.match(view, /className="nbm-lrow-act" onClick=\{\(\) => router\.replace/);
  assert.match(css, /\.nbm-lrow\s*\{[^}]*min-height:\s*56px/);
});

test('file names cut in the middle (the version and extension stay); the full name on hover', () => {
  assert.match(files, /\{middleCut\(file\.name \|\| "File"\)\}/);
  assert.match(files, /title=\{file\.name\}/);
});

test('the list skeleton breathes in square blocks (no shimmer)', () => {
  assert.doesNotMatch(skel, /Skeleton } from/);
  assert.match(skel, /nbm-sk/);
});
