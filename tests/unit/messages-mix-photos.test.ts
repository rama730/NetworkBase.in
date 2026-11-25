import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { groupByMonth } from '../../src/lib/messaging/photos';

test('groupByMonth: newest month first, files kept in order', () => {
  const files = [
    { asset_id: 'a', created_at: '2026-11-20T10:00:00Z' },
    { asset_id: 'b', created_at: '2026-11-02T10:00:00Z' },
    { asset_id: 'c', created_at: '2026-10-30T10:00:00Z' },
  ];
  const groups = groupByMonth(files, 'en-US', 'UTC');
  assert.deepEqual(groups.map((g) => [g.label, g.files.map((f) => f.asset_id)]), [['November 2026', ['a', 'b']], ['October 2026', ['c']]]);
  assert.deepEqual(groupByMonth([], 'en-US', 'UTC'), []);
});

const action = readFileSync('src/app/actions/chat/messages.ts', 'utf8');
const view = readFileSync('src/components/messages/parts/FilesView.tsx', 'utf8');
const css = readFileSync('src/components/messages/messages-mix.css', 'utf8');

test('listFiles: a media filter and a (seq, idx) cursor; it says where the next page starts', () => {
  assert.match(action, /export async function listFiles\(input: \{ channelId: string; kind\?: "media"; before\?: \{ seq: number; idx: number \} \}\)/);
  assert.match(action, /a\.mime LIKE 'image\/%' OR a\.mime LIKE 'video\/%'/);
  assert.match(action, /a\.message_seq < \$\{input\.before\.seq\}::bigint OR \(a\.message_seq = \$\{input\.before\.seq\}::bigint AND a\.idx > \$\{input\.before\.idx\}::int\)/);
  assert.match(action, /next: rows\.length > limit \? \{ seq: last\.seq, idx: last\.idx \} : null/);
});

test('Files tab: List | Photos switch, a month grid, Load older, the empty words', () => {
  assert.match(view, /role="radiogroup" aria-label="Show files as" className="nbm-seg"/);
  assert.match(view, /className="nbm-photos /);
  assert.match(view, /"Load older"/);
  assert.match(view, /No photos or videos yet/);
  assert.match(view, /Photos and videos shared here show up in this view\./);
  assert.match(view, /<MediaViewerModal/);
  assert.match(css, /\.nbm-photos-grid\s*\{[^}]*grid-template-columns/);
});
