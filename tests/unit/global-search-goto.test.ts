import assert from 'node:assert/strict';
import test from 'node:test';

import { searchGoto, verbActions } from '../../src/lib/search/global/goto';

const place = { kind: 'workspace' as const, name: 'CSE 3B', href: '/workspaces/cse-3b' };

test('"dark" finds the theme setting with its control right there', () => {
  const theme = searchGoto('dark', { place: null }).find((item) => item.meta.control === 'theme');
  assert.ok(theme);
  assert.equal(theme.kind, 'goto');
  assert.match(theme.sub, /^Settings · Appearance/);
});

test('"who can find me" is a setting you can flip in place', () => {
  const item = searchGoto('find me', { place: null }).find((row) => row.meta.control === 'findMe');
  assert.equal(item?.title, 'Who can find me in search');
  assert.equal(item?.href, '/settings#settings-privacy-find');
});

test('pages are there too', () => {
  assert.equal(searchGoto('my work', { place: null })[0]?.href, '/my-work');
});

test('"new" shows actions first; one needs the workspace you are in', () => {
  assert.deepEqual(verbActions('new', place).map((a) => a.title), ['New workspace', 'New task in CSE 3B', 'New message', 'New post in CSE 3B']);
  assert.deepEqual(verbActions('new', null).map((a) => a.title), ['New workspace', 'New message']);
  assert.equal(verbActions('new', place)[1]!.href, '/workspaces/cse-3b?tab=tasks&new=1');
  assert.equal(verbActions('new task', place).length, 1);
  assert.deepEqual(verbActions('react', place), []);
});
