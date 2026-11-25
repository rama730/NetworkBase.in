import assert from 'node:assert/strict';
import test from 'node:test';
import { capChannels, groupTitle } from '../../src/lib/messaging/channel-view';

test('capChannels keeps every unread row plus the first 12 read rows, in order', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, unread: i === 40 || i === 55 }));
  const { shown, hidden } = capChannels(rows, (r) => r.unread);
  assert.deepEqual(shown.map((r) => r.id), [...Array.from({ length: 12 }, (_, i) => `c${i}`), 'c40', 'c55']);
  assert.equal(hidden, 46);
});

test('capChannels hides nothing at or under the cap', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}` }));
  assert.deepEqual(capChannels(rows, () => false), { shown: rows, hidden: 0 });
});

test('groupTitle names three people and counts the rest', () => {
  assert.equal(groupTitle(['Ana', 'Ben', 'Chen', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy']), 'Ana, Ben, Chen and 6 others');
  assert.equal(groupTitle(['Ana', 'Ben', 'Chen'], 9), 'Ana, Ben, Chen and 6 others');
  assert.equal(groupTitle(['Ana', 'Ben', 'Chen'], 4), 'Ana, Ben, Chen and 1 other');
  assert.equal(groupTitle(['Ana', 'Ben']), 'Ana and Ben');
});
