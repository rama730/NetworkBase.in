import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const screen = readFileSync('src/components/messages/ViewScreen.tsx', 'utf8');
const views = readFileSync('src/components/messages/MessagesViews.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('one screen header: 64px, serif title, square cells', () => {
  assert.equal((screen.match(/<header className="nbm-lhead">/g) ?? []).length, 2);
  assert.match(screen, /<h1 className="nbm-lhead-title">\{title\}<\/h1>/);
  assert.doesNotMatch(screen, /nb-icon-button/);
  assert.match(css, /\.nbm-lhead\s*\{[^}]*height:\s*64px/);
  assert.match(css, /\.nbm-lhead-title\s*\{[^}]*var\(--nbm-serif\)/);
});

test('one row layout: mono time column, avatar, who and two lines; unread = warm paper + bold', () => {
  assert.match(views, /className=\{`nbm-lrowx group\/snippet\$\{unread \? " is-unread" : ""\}`\}/);
  assert.match(views, /<span className="nbm-lrowx-time" title=/);
  assert.match(css, /\.nbm-lrowx\.is-unread\s*\{[^}]*var\(--nbm-hl\)/);
  assert.match(css, /\.nbm-lrowx-time\s*\{[^}]*var\(--nbm-mono\)/);
});

test('Inbox groups: a mono label with a rule and Mark as read; no indented left border', () => {
  assert.doesNotMatch(views, /border-l-2 border-border pl-2/);
  assert.match(views, /className="nbm-igroup"/);
  assert.match(views, /<span className="nbm-glabel-rule" aria-hidden="true" \/>/);
});

test('Inbox tabs are mix tabs with padded counts; the inline reply is a composer cell', () => {
  assert.match(views, /className="nbm-tab flex-none gap-1\.5"/);
  assert.match(views, /<span className="nbm-count ml-1\.5"><span aria-hidden="true">\{padCount\(counts\[f\.id\]\)\}<\/span>/);
  assert.match(views, /className="nbm-ireply"/);
});

test('Saved: reminder tags (Set / Due warn / Sent); Drafts and scheduled: mono groups, failed in red mono', () => {
  assert.match(views, /<span className=\{`nbm-tag \$\{due \? "warn" : ""\}`\}>/);
  assert.match(views, /<h2 id="drafts-heading" className="nbm-glabel nbm-lgroup">/);
  assert.match(views, /<h2 id="scheduled-heading" className="nbm-glabel nbm-lgroup">/);
  assert.match(views, /className=\{item\.failed_reason \? "nbm-failed-label" : "nbm-lrow-meta"\}/);
});
