import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const views = readFileSync('src/components/messages/MessagesViews.tsx', 'utf8');
const prim = readFileSync('src/components/messages/mix/primitives.tsx', 'utf8');
const home = readFileSync('src/components/messages/HomePane.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('the time column holds only the time (it may wrap), after the text in reading order; the label moves to the head', () => {
  assert.match(views, /\{timeLabel \? <span className="nbm-lrow-meta flex-none">\{timeLabel\}<\/span> : null\}/);
  assert.match(views, /<span className="nbm-lrowx-time" title=\{time \? fullTime\(time\) : undefined\}>\{when\(time\)\}<\/span>/);
  assert.match(css, /\.nbm-lrowx-time\s*\{[^}]*order:\s*-1[^}]*white-space:\s*normal/);
});

test('Inbox group headers: Mark as read has its own class; the label keeps its title', () => {
  assert.match(views, /className="nbm-igroup-act/);
  assert.doesNotMatch(css, /\.nbm-igroup > button:last-child/);
  assert.match(views, /<span title=\{fullTime\(items\[0\]!\.created_at\)\}>\{when\(items\[0\]!\.created_at\)\}<\/span>/);
});

test('segmented radio cells are one roving group (arrow keys), shared', () => {
  assert.match(prim, /export function RadioCells</);
  assert.match(prim, /rovingTabKey/);
  assert.equal((views.match(/<RadioCells\b/g) ?? []).length, 2);
});

test('small fixes: results line in capitals, Home action reset, compact window titles, tab count spacing', () => {
  assert.match(css, /\.nbm-lgroup\.nbm-lrow-meta\s*\{[^}]*text-transform:\s*uppercase/);
  assert.match(home, /className="nbm-glabel-act /);
  assert.match(css, /\.nbm\[data-testid="chat-window"\] \.nbm-lhead-title/);
  assert.match(views, /className="nbm-tab flex-none"/);
});
