import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { shellPathFor } from '../../src/lib/navigation/shell-path';

// What the signed-in live check of the Messages mix found (2026-11-26), one test per fix.
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');
const src = (path: string) => readFileSync(path, 'utf8');

test('a section header keeps its count visible: the hover buttons fill only while the section is hovered or focused', () => {
  assert.match(css, /\.nbm \.nb-chat-section-acts \{[^}]*background: transparent/);
  assert.match(css, /\.nbm section:hover > \.nb-chat-section-title \.nb-chat-section-acts, \.nbm section:focus-within > \.nb-chat-section-title \.nb-chat-section-acts \{ background: var\(--card\); \}/);
});

test('the search field shows one clear ×, ours', () => {
  assert.match(css, /\.nbm-find::-webkit-search-cancel-button \{ display: none; \}/);
});

test('the top path never shows the w in /messages/w/<workspace>/…', () => {
  assert.equal(shellPathFor('/messages/w/8667a260-6122-4d64-9369-acdf7e6f7b45/browse'), 'messages/browse');
  assert.equal(shellPathFor('/messages/w/8667a260-6122-4d64-9369-acdf7e6f7b45'), 'messages');
  assert.equal(shellPathFor('/u/w'), 'u/w', 'only the messages route marker');
});

test('a details row puts its choice cells under the label, never touching it', () => {
  assert.match(css, /\.nbm-drow > \.nbm-drow-label \+ \.nbm-seg-wrap \{ display: flex; width: fit-content; \}/);
});

test('the note bar: Copy link stays on one line and the edited tag ends in …', () => {
  assert.match(css, /\.nbm-note-bar \.nbm-tag \{ display: block;/);
  assert.match(css, /\.nbm-note-bar > :last-child \{ flex: none; \}/);
  assert.match(css, /\.nbm-note-copy \{[^}]*white-space: nowrap/);
});

test('a toast about an action picked from a menu stays over the pane the menu came from', () => {
  assert.match(src('src/components/feedback/FeedbackHost.tsx'), /closest\('\[data-feedback-portal\], \[data-radix-popper-content-wrapper\]'\)/);
});

test('Messages menus scroll when the window is shorter than they are', () => {
  assert.match(css, /\.nbm-menu \{[^}]*max-height: var\(--radix-dropdown-menu-content-available-height, 80vh\); overflow-y: auto;/);
});

test('pinning from a thread updates the thread too, and an edit refreshes Pins', () => {
  const row = src('src/components/messages/MessageRow.tsx');
  assert.match(row, /invalidateQueries\(\{ queryKey: \["chat-v3", "thread", ctx\.channelId\] \}\)/);
  assert.match(row, /if \(!result\.success\) \{\n\s+update\(\(pages\) => patchPages\(pages, message\.seq, \(m\) => \(\{ \.\.\.m, \.\.\.previous \}\)\)\);\n\s+toast\.error\(chatErrorMessage\(result\.error\)\);\n\s+\} else void queryClient\.invalidateQueries\(\{ queryKey: queryKeys\.chat\.pins\(ctx\.channelId\) \}\);/);
});

test('a poll vote is not a recent reaction', () => {
  assert.match(src('src/components/messages/MessageRow.tsx'), /if \(on && !pollParts\(message\.body\)\) noteReaction\(emoji\);/);
});

test('poll counts take a fixed column, so every bar ends at the same point', () => {
  assert.match(css, /\.nbm-poll-opt \{ display: grid; grid-template-columns: 28px minmax\(0, 1fr\) 52px 64px;/);
  assert.match(css, /\.nbm-poll-count \{ grid-column: -2;[^}]*text-align: right;/);
});

test('Share message names the workspace beside each conversation', () => {
  const share = src('src/components/messages/parts/ShareDialog.tsx');
  assert.match(share, /const projects = useMemo\(\(\) => new Map\(\(data\?\.projects \?\? \[\]\)\.map\(\(p\) => \[p\.id, p\.title\]\)\)/);
  assert.match(share, /<span className="nbm-lrow-meta ml-auto max-w-\[40%\] flex-none truncate">\{place\}<\/span>/);
});

test('the header people button says "1 member"', () => {
  assert.match(src('src/components/messages/ConversationView.tsx'), /aria-label=\{`\$\{channel\.member_count\} \$\{channel\.member_count === 1 \? "member" : "members"\}`\}/);
});

test('swipe cells stay hidden until a row is swiped (a narrow desktop window showed them beside the ⋯ button)', () => {
  assert.match(css, /\.nbm \.nb-chat-swipe-actions\[aria-hidden="true"\] \{ visibility: hidden; \}/);
});
