import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { seenAfter, seenLabel } from '../../src/lib/messaging/seen';

const read = (p: string) => readFileSync(p, 'utf8');
const msg = (seq: number, author: string, extra = {}) => ({ seq, author_id: author, kind: 'user', thread_root_seq: null, ...extra }) as never;

test('seenLabel: today, yesterday, older; the spoken form says "at"', () => {
  const now = new Date(2026, 10, 25, 15, 0);
  assert.deepEqual(seenLabel(new Date(2026, 10, 25, 9, 42).toISOString(), now, 'en-US'), { text: 'Seen 9:42 AM', spoken: 'Seen at 9:42 AM' });
  assert.deepEqual(seenLabel(new Date(2026, 10, 24, 18, 10).toISOString(), now, 'en-US'), { text: 'Seen yesterday 6:10 PM', spoken: 'Seen yesterday at 6:10 PM' });
  assert.deepEqual(seenLabel(new Date(2026, 10, 21, 8, 0).toISOString(), now, 'en-US'), { text: 'Seen Nov 21', spoken: 'Seen Nov 21' });
});

test('seenAfter: under your last own message once they have read it, gone once they reply', () => {
  const peer = { seq: 5, at: '2026-11-25T09:42:00Z' };
  assert.equal(seenAfter([msg(4, 'me'), msg(5, 'me')], 'me', peer), 5);
  assert.equal(seenAfter([msg(4, 'me'), msg(6, 'me')], 'me', peer), null, 'not read that far yet');
  assert.equal(seenAfter([msg(4, 'me'), msg(5, 'them')], 'me', peer), null, 'they replied');
  assert.equal(seenAfter([msg(4, 'me'), msg(5, 'me', { thread_root_seq: 2 })], 'me', peer), 4, 'thread replies do not count');
  assert.equal(seenAfter([msg(4, 'me')], 'me', null), null);
});

test('0150: seen columns, the receipts setting on by default, mark_read sets them and only forward, mark_unread untouched', () => {
  const sql = read('drizzle/0150_chat_seen.sql');
  assert.match(sql, /SET LOCAL lock_timeout = '5s'/);
  assert.match(sql, /ADD COLUMN seen_seq bigint/);
  assert.match(sql, /ADD COLUMN seen_at timestamptz/);
  assert.match(sql, /ADD COLUMN read_receipts boolean NOT NULL DEFAULT true/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION app_private\.chat_mark_read/);
  assert.match(sql, /seen_seq = greatest\(coalesce\(m\.seen_seq, 0\), p_seq\)/);
  assert.doesNotMatch(sql, /chat_mark_unread/);
  const journal = read('drizzle/meta/_journal.json');
  assert.match(journal, /"tag": "0150_chat_seen"/);
  assert.match(read('standards/sql-governance.manifest.json'), /drizzle\/0150_chat_seen\.sql/);
});

test('the server shares "seen" only in a 1:1 DM, with receipts on for both, never across a block', () => {
  const channels = read('src/app/actions/chat/channels.ts');
  assert.match(channels, /AS peer_seen/);
  assert.match(channels, /c\.kind = 'dm' AND c\.member_count = 2 AND c\.application_id IS NULL/);
  assert.match(channels, /op\.read_receipts AND mp\.read_receipts/);
  assert.match(channels, /NOT app_private\.chat_is_blocked\(\$\{user\.id\}::uuid, o\.user_id\)/);
  const readActions = read('src/app/actions/chat/read.ts');
  assert.match(readActions, /publishUser\(peer\.user_id, "read\.seen"/);
  assert.match(read('src/app/actions/presence.ts'), /export async function setReadReceipts/);
});

test('Settings › Privacy has the switch; the timeline draws the line; the shell applies live reads', () => {
  const privacy = read('src/components/settings/PrivacySettings.tsx');
  assert.match(privacy, /Send read receipts/);
  assert.match(privacy, /In one-to-one messages, people see when you’ve read their message\. Off: they don’t, and you don’t see theirs either\./);
  const timeline = read('src/components/messages/Timeline.tsx');
  assert.match(timeline, /className="nbm-seen"/);
  assert.match(timeline, /seenAfter\(/);
  assert.match(read('src/components/messages/ChatShellProvider.tsx'), /event === "read\.seen"/);
});
