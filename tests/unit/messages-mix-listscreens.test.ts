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
  assert.match(views, /className="nbm-tab flex-none"/);
  assert.match(views, /<span className="nbm-count ml-1\.5"><span aria-hidden="true">\{padCount\(counts\[f\.id\]\)\}<\/span>/);
  assert.match(views, /className="nbm-ireply"/);
});

test('Saved: reminder tags (Set / Due warn / Sent); Drafts and scheduled: mono groups, failed in red mono', () => {
  assert.match(views, /<span className=\{`nbm-tag \$\{due \? "warn" : ""\}`\}>/);
  assert.match(views, /<h2 id="drafts-heading" className="nbm-glabel nbm-lgroup">/);
  assert.match(views, /<h2 id="scheduled-heading" className="nbm-glabel nbm-lgroup">/);
  assert.match(views, /className=\{item\.failed_reason \? "nbm-failed-label" : "nbm-lrow-meta"\}/);
});

test('Search: big find field, filter cells with an ink set state, warm-mark highlights, mono result line', () => {
  assert.match(views, /className="nbm-find pl-9 pr-10"/);
  assert.match(views, /data-set=\{hasFile \? "true" : undefined\}/);
  assert.match(views, /<mark key=\{i\} className="nbm-hit">/);
  assert.match(views, /<p className="nbm-lgroup nbm-lrow-meta">\{resultPages\.hasNextPage/);
  assert.match(css, /\.nbm-hit\s*\{[^}]*var\(--nbm-mark\)/);
  assert.match(css, /\.nbm-fcell\[data-set="true"\][^{]*\{[^}]*var\(--nbm-ink\)/);
});

test('Browse: Show and Sort as segmented cells; Joined is a square tag', () => {
  assert.match(views, /<RadioCells label="Show"/);
  assert.match(views, /<RadioCells label="Sort"/);
  assert.match(views, /<span className="nbm-tag flex-none"><Check size=\{12\} aria-hidden="true" \/> Joined<\/span>/);
});
