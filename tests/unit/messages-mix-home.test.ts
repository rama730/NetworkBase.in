import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const home = readFileSync('src/components/messages/HomePane.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('Home: no band, serif title, mono line, check rows as list cells, Unread as cells', () => {
  assert.match(home, /<header className="nbm-lhead">/);
  assert.match(home, /<h1 className="nbm-lhead-title">/);
  assert.match(home, /<p className="nbm-home-line">/);
  assert.equal((home.match(/className="nbm-checkrow"/g) ?? []).length, 2);
  assert.match(home, /<section className="nbm-home-list" aria-label=\{title\}>/);
  assert.doesNotMatch(home, /rounded-lg border border-border bg-card p-5/);
});

test('EmptyState v2 in Messages: a pixel figure (never a Lucide icon), serif line, one sentence', () => {
  const withIcon = execSync(`grep -rnE "<(EmptyState|Empty)\\b[^>]*\\bicon=" src/components/messages || true`, { encoding: 'utf8' }).trim();
  assert.equal(withIcon, '');
  assert.match(css, /\.nbm \.nb-empty-state \.nb-card-title\s*\{[^}]*var\(--nbm-serif\)/);
  assert.match(css, /\.nbm \.nb-empty-state \.nb-empty-figure\s*\{[^}]*width:\s*48px/);
});
