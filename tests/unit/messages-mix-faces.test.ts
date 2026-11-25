import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { pollStats } from '../../src/lib/messaging/poll';
import { applyReaction, upsertMessage } from '../../src/lib/messaging/timeline';

const read = (p: string) => readFileSync(p, 'utf8');
const options = [{ emoji: '1️⃣', label: 'A' }, { emoji: '2️⃣', label: 'B' }];

test('pollStats counts people when voters are known; each share is votes ÷ people', () => {
  const stats = pollStats(options, [
    { emoji: '1️⃣', count: 3, me: true, user_ids: ['a', 'b', 'c'] },
    { emoji: '2️⃣', count: 2, me: false, user_ids: ['a', 'd'] },
  ]);
  assert.equal(stats.votes, 5);
  assert.equal(stats.people, 4);
  assert.deepEqual(stats.options.map((o) => o.share), [75, 50]);
  assert.deepEqual(stats.options[1]!.voters, ['a', 'd']);
});

test('pollStats without voter ids falls back to votes ÷ votes and no people count', () => {
  const stats = pollStats(options, [{ emoji: '1️⃣', count: 1, me: false }]);
  assert.equal(stats.people, null);
  assert.deepEqual(stats.options.map((o) => o.share), [100, 0]);
});

test('a live vote keeps the voter list in step', () => {
  const on = applyReaction([{ emoji: '1️⃣', count: 1, me: false, user_ids: ['a'] }], '1️⃣', true, true, 'me');
  assert.deepEqual(on[0]!.user_ids, ['me', 'a']);
  const off = applyReaction(on, '1️⃣', false, false, 'a');
  assert.deepEqual(off[0]!.user_ids, ['me']);
  assert.equal(applyReaction([{ emoji: '1️⃣', count: 1, me: false }], '1️⃣', true, false, 'x')[0]!.user_ids, undefined, 'no list, none made up');
});

test('a live reply puts its author first among the last repliers (at most 3, no repeats)', () => {
  const root = { seq: 1, thread_root_seq: null, reply_count: 2, last_reply_seq: 3, last_reply_at: null, last_repliers: ['b', 'c', 'd'] } as never;
  const reply = { seq: 4, thread_root_seq: 1, author_id: 'c', created_at: '2026-11-26T00:00:00Z' } as never;
  const [[next]] = upsertMessage([[root]], reply) as never as [[{ last_repliers: string[]; reply_count: number }]];
  assert.deepEqual(next.last_repliers, ['c', 'b', 'd']);
  assert.equal(next.reply_count, 3);
});

test('the server sends last repliers and poll voters (never someone blocked); the row draws faces and "voted"', () => {
  const q = read('src/lib/messaging/queries.ts');
  assert.match(q, /AS last_repliers/);
  assert.match(q, /m\.body LIKE '📊 \*\*Poll: %'/);
  assert.match(q, /NOT app_private\.chat_is_blocked\(\$\{viewerId\}::uuid, v\.user_id\)/);
  const row = read('src/components/messages/MessageRow.tsx');
  assert.match(row, /className="nbm-thr-faces"/);
  assert.match(row, /voted \$\{/);
  assert.doesNotMatch(row, /reacted with \$\{option\.emoji\}/);
  assert.match(row, /stats\.people \? ` · \$\{stats\.people\} \$\{stats\.people === 1 \? "person" : "people"\}`/);
});

test('live votes add only your own face; others come from the server, which leaves out anyone blocked', () => {
  for (const file of ['src/components/messages/useConversation.ts', 'src/components/messages/ThreadPane.tsx']) {
    assert.match(read(file), /mine && typeof payload\.user_id === "string" \? payload\.user_id : undefined/, file);
  }
});

test('a poll option keeps number, bar, faces and count on one row', () => {
  const css = read('src/components/messages/messages-mix.css');
  assert.match(css, /\.nbm-poll-opt \{ display: grid; grid-template-columns: 28px minmax\(0, 1fr\) 52px auto;/);
  assert.match(css, /\.nbm-poll-count \{ grid-column: -2;/);
});
