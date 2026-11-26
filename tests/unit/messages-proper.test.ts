import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { channelTitle } from '../../src/lib/messaging/channel-view';
import type { ChatChannelSummary } from '../../src/lib/messaging/types';

// "Make Messages proper" (2026-11-26): what was still not ideal after the two-person check.
const src = (path: string) => readFileSync(path, 'utf8');

test('a team’s main channel is named for the team, without the slug’s random ending', () => {
  const migration = src('drizzle/0154_team_channel_names.sql');
  assert.match(migration, /lower\(p\.title\)/, 'from the title, not the slug');
  assert.doesNotMatch(migration, /p\.slug/);
  assert.match(migration, /AND NOT EXISTS \(\s*SELECT 1 FROM public\.chat_channels x/, 'never collides with another channel in the team');
  // The display-only "general" is gone: one name everywhere (header, threads, switcher, search, links).
  assert.doesNotMatch(src('src/lib/messaging/channel-view.ts'), /\? "general" : channel\.name/);
});

test('opening a conversation: messages first, the rest after', () => {
  const view = src('src/components/messages/ConversationView.tsx');
  assert.match(view, /early: details\.isPending/);
  assert.match(view, /const firstPaint = !conversation\.query\.isPending;/);
  for (const hook of ['useChannelMembers(channelId, isMember && firstPaint)', 'useChannelTabs(channelId, isMember && firstPaint)', 'useSavedSeqs(channelId, isMember && firstPaint)', 'usePersonContext(person.id, ready)']) {
    assert.ok(view.includes(hook), hook);
  }
});

test('your own join, topic or unarchive line shows even if the live event missed your tab', () => {
  const view = src('src/components/messages/ConversationView.tsx');
  assert.match(view, /before !== eventSig && !conversation\.query\.isPending\) void conversation\.query\.refetch\(\)/);
  assert.match(view, /channel\.is_member\]\.join/, 'your own membership, not the member count: a busy channel’s joins don’t reload every open tab');
  assert.doesNotMatch(view, /channel\.member_count, channel\.kind\]\.join/);
});

test('closing the photo viewer always clears ?ov=media from the address', () => {
  assert.match(src('src/lib/navigation/overlay-history.ts'), /\} else if \(new URLSearchParams\(window\.location\.search\)\.get\("ov"\) === key\) \{\n[^\n]*\n\s+writeUrl\(window, href\(null\), "replace"\);/);
});

test('"Jump to…" reads in full beside All / Unread (the shortcut moves to the tooltip)', () => {
  const sections = src('src/components/messages/ChatSections.tsx');
  assert.match(sections, /className="nb-chat-jump" title=\{`Jump to… \(\$\{searchHint\}\)`\}/);
  assert.doesNotMatch(sections, /Jump to…<\/span>\n\s+<kbd className="nbm-mono pointer-coarse:hidden">\{searchHint\}<\/kbd>/);
});

test('chat files: one list of types for the upload check and the storage bucket', async () => {
  const { CHAT_FILE_TYPES, chatFileTypeAllowed } = await import('../../src/lib/messaging/attachment-types');
  for (const type of ['application/x-gzip', 'text/x-markdown', 'application/vnd.rar', 'application/x-rar-compressed', 'application/csv', 'audio/mp3', 'application/zip', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/heic', 'audio/mpeg', 'application/pdf']) {
    assert.equal(chatFileTypeAllowed(type), true, type);
  }
  for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream', 'application/x-msdownload']) {
    assert.equal(chatFileTypeAllowed(type), false, type);
  }
  const migration = src('drizzle/0153_chat_file_types.sql');
  const listed = [...migration.matchAll(/'([a-z0-9.+-]+\/[a-z0-9.+-]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, [...CHAT_FILE_TYPES].sort(), 'the bucket allows exactly the app list');
  assert.match(src('src/app/api/v1/chat/attachments/presign/route.ts'), /if \(!chatFileTypeAllowed\(mimeType\)\) return jsonError\(/);
});
