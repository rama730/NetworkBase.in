import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { seenAfter } from '../../src/lib/messaging/seen';
import { previewIds, previewText, mentionedRecipients } from '../../src/lib/messaging/tokens';
import { applyHint, applyReadMoved, chatBadge } from '../../src/lib/messaging/shell-state';
import { countNoun, placeOf, rowCount } from '../../src/lib/messaging/channel-view';
import { isRefusedSend } from '../../src/lib/messaging/errors';
import { scheduledRefetchMs } from '../../src/lib/messaging/schedule-window';
import { zoneName } from '../../src/lib/organizations/zoned-time';
import type { ChatBootstrap, ChatChannelSummary } from '../../src/lib/messaging/types';

// What the two-person live check found (2026-11-26, docs/superpowers/plans/2026-11-26-messages-person-b-findings.md).
const src = (path: string) => readFileSync(path, 'utf8');
const A = '2b4030a1-b030-4a50-811a-0da96b88c224';
const CH = '543b2b4a-b7cb-4510-900e-0bdc07e2dcf9';

const dm = (over: Partial<ChatChannelSummary> = {}) => ({
  id: 'c1', kind: 'dm', name: null, notify: 'all', last_seq: 22, last_top_seq: 22, last_read_seq: 10, mention_count: 0,
  last_preview: 'old', last_message_at: '2026-11-26T08:00:00Z', last_author_id: 'b', application_id: null,
  ...over,
} as unknown as ChatChannelSummary);
const shell = (channel: ChatChannelSummary) => ({ channels: [channel], inbox_unread: 0, inbox_mentions: 0 } as unknown as ChatBootstrap);

test('#5 Seen stays under your message when the other person sent one and deleted it', () => {
  const rows = [
    { seq: 5, author_id: 'me', kind: 'user', thread_root_seq: null, deleted_at: null },
    { seq: 6, author_id: 'peer', kind: 'user', thread_root_seq: null, deleted_at: '2026-11-26T08:00:00Z' },
  ];
  assert.equal(seenAfter(rows, 'me', { seq: 6, at: '2026-11-26T08:00:00Z' }), 5);
});

test('#3 a preview names people and channels instead of showing their codes', () => {
  const raw = `Mention check <@${A}> in <#${CH}> <!here>`;
  assert.deepEqual(previewIds(raw), { users: [A], channels: [CH] });
  assert.equal(previewText(raw, (id) => (id === A ? 'Ramanayudu CH' : undefined), (id) => (id === CH ? 'general' : undefined)), 'Mention check @Ramanayudu CH in #general @here');
});

test('#1 @here and @channel count as a mention for everyone the message reaches', () => {
  assert.deepEqual(mentionedRecipients(['a'], null, ['a', 'b']), ['a']);
  assert.deepEqual(mentionedRecipients([], 'here', ['a', 'b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(mentionedRecipients(['a'], 'channel', ['a', 'b']), ['a', 'b']);
});

test('#4 a new message updates the row’s preview, time and author live; a thread reply doesn’t', () => {
  const next = applyHint(shell(dm({ last_top_seq: 10 })), { channel_id: 'c1', seq: 23, mention: false, thread_root_seq: null, preview: 'Bell check', at: '2026-11-26T09:07:00Z', author_id: 'b' })!;
  assert.equal(next.channels[0]!.last_preview, 'Bell check');
  assert.equal(next.channels[0]!.last_message_at, '2026-11-26T09:07:00Z');
  const reply = applyHint(shell(dm({ last_top_seq: 10 })), { channel_id: 'c1', seq: 23, mention: false, thread_root_seq: 4, preview: 'in a thread', at: '2026-11-26T09:07:00Z', author_id: 'b' })!;
  assert.equal(reply.channels[0]!.last_preview, 'old');
});

test('#7 a DM counts the other person’s messages, not seq numbers', () => {
  assert.equal(rowCount(dm({ unread_count: 1 })), 1, 'mark unread before 11 own/deleted messages: 1, not 12');
  const hinted = applyHint(shell(dm({ last_top_seq: 22, last_read_seq: 22, unread_count: 0 })), { channel_id: 'c1', seq: 23, mention: false, thread_root_seq: null })!;
  assert.equal(rowCount(hinted.channels[0]!), 1);
  assert.equal(applyReadMoved(hinted, 'c1', 23).channels[0]!.unread_count, 0);
  assert.equal(chatBadge(shell(dm({ last_top_seq: 22, last_read_seq: 10, unread_count: 0 }))), 0, 'the nav badge follows the row: a sent-then-deleted message isn’t unread');
});

test('#7 the bootstrap computes unread_count from the server', () => {
  assert.match(src('src/app/actions/chat/read.ts'), /withUnreadCounts\(/);
});

test('#10 a send the server refuses for good goes back in the box, never Retry', () => {
  assert.equal(isRefusedSend('chat_general_admins_only'), true);
  assert.equal(isRefusedSend('chat_channel_archived'), true);
  assert.equal(isRefusedSend('chat_network'), false);
  assert.equal(isRefusedSend('chat_rate_limited'), false);
  assert.match(src('src/components/messages/Composer.tsx'), /isRefusedSend\(result\.error\) && !assetIds\.length && !editor\?\.getText\(\)\.trim\(\)/, 'files, or something typed since, keep the Not sent row');
});

test('#10 turning on admins-only tells open #general screens', () => {
  assert.match(src('src/app/actions/org-chat.ts'), /publishChannel\([^)]*"channel\.updated"/);
});

test('#17 the schedule picker names the zone the way people say it', () => {
  assert.equal(zoneName('Asia/Calcutta'), 'India Standard Time');
  assert.match(src('src/components/messages/parts/TimePickerDialog.tsx'), /Your time zone: \{zoneName\(zone\)\}/);
  assert.match(src('src/components/messages/parts/TimePickerDialog.tsx'), /<DateTimeField/);
  assert.match(src('src/components/messages/parts/TimePickerDialog.tsx'), /Pick a time at least a minute from now and within 120 days\./);
});

test('#8 the scheduled list refreshes once its next message is due', () => {
  const now = Date.parse('2026-11-26T09:00:00Z');
  assert.equal(scheduledRefetchMs([{ send_at: '2026-11-26T09:02:00Z' }, { send_at: '2026-11-26T10:00:00Z' }], now), 125_000);
  assert.equal(scheduledRefetchMs([{ send_at: '2026-11-26T08:59:00Z' }], now), 5_000, 'already due: soon');
  assert.equal(scheduledRefetchMs([], now), false);
  assert.equal(scheduledRefetchMs([{ send_at: '2026-11-26T08:00:00Z', failed_reason: 'chat_blocked' }], now), false, 'a failed one never polls every 5 s');
  assert.match(src('src/components/messages/ChatSections.tsx'), /refetchInterval: \(query\) => scheduledRefetchMs\(/);
});

test('#15 a DM is "your DM with Rama", not "Rama", in Inbox, Saved and Search', () => {
  assert.equal(placeOf({ channel_name: null, channel_title: 'Rama', channel_kind: 'dm' }), 'your DM with Rama');
  assert.equal(placeOf({ channel_name: 'general', channel_kind: 'public' }), '#general');
  assert.equal(placeOf({ channel_name: null, channel_title: 'Ann, Bo', channel_kind: 'private' }), 'Ann, Bo');
});

test('#20 one unread conversation is singular for screen readers', () => {
  assert.equal(countNoun(1, 'unread conversations'), 'unread conversation');
  assert.equal(countNoun(2, 'unread conversations'), 'unread conversations');
  assert.equal(countNoun(1, 'mentions'), 'mention');
  assert.match(src('src/components/messages/ChatSections.tsx'), /countNoun\(count, noun\)/);
});

test('#1 the send path uses mentionedRecipients', () => {
  assert.match(src('src/lib/messaging/send.ts'), /mentioned: mentionedRecipients\(userIds, broadcast, result\.notify \?\? \[\]\)/);
});

test('#2 joining, leaving, adding, removing and topic changes show their line live (no unread nudge)', () => {
  const channels = src('src/app/actions/chat/channels.ts');
  for (const fn of ['joinChannel', 'leaveChannel', 'updateChannel', 'unarchiveChannel', 'renameGroup', 'setChannelPrivacy']) {
    const body = channels.slice(channels.indexOf(`export async function ${fn}(`), channels.indexOf('export async function', channels.indexOf(`export async function ${fn}(`) + 10));
    assert.equal(body.match(/publishChannelActivity\(input\.channelId, user\.id, \{ hint: false \}\)/g)?.length, 1, fn);
  }
  const archive = channels.slice(channels.indexOf('export async function archiveChannel('), channels.indexOf('export async function unarchiveChannel('));
  assert.doesNotMatch(archive, /publishChannelActivity/, 'archiving writes no line: no reload for every viewer');
  assert.match(src('src/lib/messaging/publish.ts'), /export function publishChannelActivity\(channelId: string, actorId: string \| null, options: \{ hint\?: boolean \} = \{\}\)/);
});

test('#4 the hint carries the preview for top-level messages', () => {
  assert.match(src('src/lib/messaging/publish.ts'), /preview: top \? preview : undefined/);
});

test('#3 the bootstrap names the people and channels in previews', () => {
  assert.match(src('src/app/actions/chat/read.ts'), /withReadablePreviews\(/);
});

test('#14 someone else’s poll vote brings their face (from the server, which filters blocks)', () => {
  assert.match(src('src/components/messages/useConversation.ts'), /if \(!mine && pollParts\(/);
  assert.match(src('src/app/actions/chat/messages.ts'), /export async function readReactions\(/);
});

test('#12 #13 presence says nothing until it has loaded (no "Offline" guess)', () => {
  assert.match(src('src/components/presence/usePresence.ts'), /const unknown = !data && !query\.isError && !options\.fallbackLastActiveAt && options\.live === undefined/);
});

test('#16 the unread count always leads the tab title', () => {
  const hook = src('src/hooks/useDocumentTitlePrefix.ts');
  assert.match(hook, /const lead = \[\.\.\.firstMarks\]\.find\(\(m\) => current\.startsWith\(m\)\)/);
  assert.doesNotMatch(hook, /current\.replace\(mark, ''\)\}/, 'never strips text out of the title ("image (1).png")');
  assert.match(src('src/components/messages/ChatShellProvider.tsx'), /useDocumentTitlePrefix\(badge \? `\(\$\{badge > 99 \? "99\+" : badge\}\)` : null, " ", \{ first: true \}\)/);
});

test('#21 an organization in common is named as one and opens at /org', () => {
  const details = src('src/components/messages/DetailsPane.tsx');
  assert.match(details, /p\.kind === "organization" \? `\/org\/\$\{p\.slug \?\? p\.id\}`/);
  assert.match(details, /Workspaces and organizations in common/);
});

test('#22 a Seen line appearing at the bottom keeps the newest message in view', () => {
  assert.match(src('src/components/messages/Timeline.tsx'), /:\$\{seenSeq \?\? ""\}`/);
});

test('#6 Inbox → Threads leaves out a thread whose message and replies are all deleted', () => {
  assert.match(src('src/app/actions/chat/activity.ts'), /AND NOT \(msg\.deleted_at IS NOT NULL AND msg\.reply_count = 0\)/);
});

test('#9 opening a conversation reads it and its messages in parallel, outside the server-action queue', () => {
  const hook = src('src/components/messages/useConversation.ts');
  assert.match(hook, /chatGet<.+?>\("channel", \{ channelId \}\)/);
  assert.match(hook, /chatGet<.+?>\("messages", \{ channelId, before: pageParam \?\? undefined, around \}\)/);
  assert.match(src('src/app/api/v1/chat/web/route.ts'), /export async function GET/);
});

test('#19 a long workspace or organization name in a sidebar heading ends in "…", not a cut letter', () => {
  assert.match(src('src/components/messages/ChatSections.tsx'), /title=\{<span className="flex min-w-0 items-center gap-1\.5"><WorkspaceBadge/);
});
