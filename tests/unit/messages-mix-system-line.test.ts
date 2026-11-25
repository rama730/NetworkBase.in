import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { foldLabel, systemLine } from '../../src/lib/messaging/system-line';

const names: Record<string, string> = { 'a1': 'Ana Ruiz', 'b2': 'Ben Okafor' };
const nameOf = (id: string) => names[id] ?? null;

test('"added" lines show names, not raw <@id> tokens (bug 7)', () => {
  assert.deepEqual(systemLine('added <@a1>, <@b2>', ['Chen Wu'], nameOf), { who: 'Chen Wu', text: 'added Ana Ruiz, Ben Okafor', title: undefined });
  assert.equal(systemLine('removed <@zz>', ['Chen Wu'], nameOf).text, 'removed someone');
});

test('a line that is already a whole sentence drops the actor in front (bug 7)', () => {
  assert.deepEqual(systemLine('Acme School assigned Mini-project proposal', ['Ada Lovelace'], nameOf), { who: null, text: 'Acme School assigned Mini-project proposal', title: undefined });
});

test('grouped lines: two names, then "and N others"; the tooltip stops at 20 names', () => {
  assert.equal(systemLine('joined #design', ['Ana', 'Ben'], nameOf).who, 'Ana and Ben');
  assert.equal(systemLine('joined #design', ['Ana', 'Ben', 'Chen'], nameOf).who, 'Ana and 2 others');
  const many = Array.from({ length: 500 }, (_, i) => `Person ${i}`);
  const title = systemLine('joined #design', many, nameOf).title!;
  assert.match(title, /and 480 others$/);
  assert.ok(title.length < 400);
});

test('long messages fold with the character count', () => {
  assert.equal(foldLabel(4000), 'Show all · 4,000 characters');
});

const row = readFileSync('src/components/messages/MessageRow.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('row states and system rows use the mix classes', () => {
  assert.match(row, /className="nbm-sys"/);
  assert.match(row, /className="nbm-sys-glyph"/);
  assert.match(row, /className="nbm-wave"/);
  assert.match(row, /<span className="nbm-tag">\{authorRole\}<\/span>/);
  assert.match(row, /className="nbm-folded"/);
  assert.match(row, /<p role="alert" className="nbm-failed">/);
  assert.match(row, /<FoldBody length=\{tokensToPlainText\(message\.body, ctx\.nameOf, ctx\.channelNameOf\)\.length\}>/);
  assert.match(css, /\.nbm-sys-glyph\s*\{[^}]*width:\s*22px[^}]*height:\s*22px[^}]*border:\s*1px solid var\(--nbm-line\)/);
  assert.match(css, /\.nbm-folded\s*\{[^}]*dashed/);
  assert.match(css, /\.nbm-failed-label\s*\{[^}]*var\(--nbm-mono\)[^}]*var\(--nbm-bad\)/);
  assert.match(css, /\.nbm-fold-body\[data-folded="true"\]\[data-over="true"\]\s*\{[^}]*max-height:/);
});
