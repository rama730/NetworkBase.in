import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { postingFooter } from '../../src/lib/messaging/posting';

const view = readFileSync('src/components/messages/ConversationView.tsx', 'utf8');
const thread = readFileSync('src/components/messages/ThreadPane.tsx', 'utf8');
const views = readFileSync('src/components/messages/MessagesViews.tsx', 'utf8');
const composer = readFileSync('src/components/messages/Composer.tsx', 'utf8');
const channels = readFileSync('src/app/actions/chat/channels.ts', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('the footer says why in a field, not by its display words', () => {
  assert.equal((postingFooter({ generalAdminsOnly: true, orgAdmin: false, readOnly: null }) as { cause: string }).cause, 'admins-only');
  assert.equal((postingFooter({ generalAdminsOnly: false, orgAdmin: false, readOnly: { reason: 'archived', title: 'X' } }) as { cause: string }).cause, 'read-only');
  assert.doesNotMatch(thread, /tag === "Admins only"|tag !== "Admins only"/);
});

test('a workspace channel holds the composer slot until posting is known (no flash, no lost focus)', () => {
  assert.match(view, /channel\.project_id && channel\.posting === undefined \? \([\s\S]{0,160}<ComposerSlotSkeleton \/>/);
});

test('the Threads view reply follows the posting rules too', () => {
  assert.match(views, /postingFooter\(details\.data\?\.posting\)/);
});

test('orgAdmin is always a boolean', () => {
  assert.match(channels, /'orgAdmin', coalesce\(p\.owner_id = \$\{user\.id\}::uuid OR EXISTS \(/);
});

test('the hint line never moves the timeline; touch keeps its targets; failed tiles keep the whole reason', () => {
  assert.match(css, /\.nbm-comp-hint\s*\{[^}]*visibility:\s*hidden/);
  assert.match(css, /\.nbm-comp:focus-within \+ \.nbm-comp-hint\s*\{\s*visibility:\s*visible/);
  assert.match(css, /@media \(pointer: coarse\) \{ \.nbm-send > \.nbm-send-more \{ padding: 0 14px; \} \}/);
  assert.match(composer, /<li key=\{u\.id\} className="nbm-tile" data-failed=\{u\.error \? "true" : undefined\} title=\{u\.error \? u\.reason : undefined\}>/);
  assert.doesNotMatch(css, /\.nbm-comp-tools\s*\{[^}]*animation/);
  assert.match(css, /\.dark \.nbm \.nbm-check:checked/);
});
