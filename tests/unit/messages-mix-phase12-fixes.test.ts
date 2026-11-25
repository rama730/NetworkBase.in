import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { pollStats } from '../../src/lib/messaging/poll';

const read = (p: string) => readFileSync(p, 'utf8');

test('thread faces never hint at a block: the server keeps every replier, the row hides only people you blocked', () => {
  const q = read('src/lib/messaging/queries.ts');
  const repliers = q.slice(q.indexOf('AS last_repliers') - 700, q.indexOf('AS last_repliers'));
  assert.doesNotMatch(repliers, /chat_is_blocked/);
  assert.match(read('src/components/messages/MessageRow.tsx'), /\.filter\(\(id\) => !ctx\.blockedIds\?\.has\(id\)\)/);
});

test('a read only becomes "Seen" in a DM, with your receipts on, and never across a block', () => {
  const sql = read('drizzle/0150_chat_seen.sql');
  assert.match(sql, /v_share boolean/);
  assert.match(sql, /c\.kind = 'dm' AND coalesce\(p\.read_receipts, true\)/);
  assert.match(sql, /app_private\.blocked_between\(p_user_id, o\.user_id\)/);
  assert.match(sql, /seen_seq = CASE WHEN v_share THEN greatest\(coalesce\(m\.seen_seq, 0\), p_seq\) ELSE m\.seen_seq END/);
});

test('a deleted account never gets the "connections" reason', () => {
  assert.match(read('src/app/actions/chat/members.ts'), /AND p\.deleted_at IS NULL\s+AND coalesce\(p\.message_privacy, 'connections'\) = 'connections'/);
});

test('the Message gate cache: asked in chunks of 100, and forgotten when your blocks change', () => {
  const gates = read('src/components/messages/message-gates.ts');
  assert.match(gates, /ids\.slice\(i, i \+ 100\)/);
  assert.match(gates, /known\.clear\(\)/);
});

test('a connection never reads "Only accepts messages from connections"', () => {
  assert.match(read('src/components/network/ConnectionsClient.tsx'), /<MessageOffMenuItem reason=\{false\} \/>/);
  assert.match(read('src/components/messages/MessageUserLink.tsx'), /export function MessageOffMenuItem\(\{ reason = true \}: \{ reason\?: boolean \}\)/);
});

test('live votes from others never push a share past what the count supports', () => {
  const stats = pollStats([{ emoji: '1️⃣', label: 'A' }, { emoji: '2️⃣', label: 'B' }], [
    { emoji: '1️⃣', count: 5, me: false, user_ids: ['a', 'b', 'c', 'd'] },
    { emoji: '2️⃣', count: 2, me: false, user_ids: ['a', 'b'] },
  ]);
  assert.equal(stats.people, 5, 'at least as many people as the biggest option has votes');
  assert.deepEqual(stats.options.map((o) => o.share), [100, 40]);
});

test('Also share in #general keeps its name when off; the reason goes in the description', () => {
  const parts = read('src/components/organizations/OrgUpdateParts.tsx');
  assert.match(parts, /aria-label="Also share in #general"/);
  assert.doesNotMatch(parts, /aria-label=\{partialAudience \?/);
});

test('the username counter counts what the field shows', () => {
  assert.match(read('src/components/sharing/ShareDialog.tsx'), /\{\(sameDraftAccount \? username : ''\)\.length\}\/20/);
});
