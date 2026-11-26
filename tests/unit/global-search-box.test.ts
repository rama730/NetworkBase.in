import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBoxGroups } from '../../src/components/layout/header/search-box/groups';
import type { GlobalSearchResult, SearchHit } from '../../src/lib/search/global/types';

const hit = (kind: SearchHit['kind'], title: string, score = 3): SearchHit => ({
  id: `${kind}:${title}`, kind, title, sub: '', href: `/${kind}/${title}`, why: null, score, createdAt: null, avatarUrl: null, tags: [], act: null, meta: {},
});
const result = (groups: GlobalSearchResult['groups'], counts: GlobalSearchResult['counts'] = {}): GlobalSearchResult => ({
  q: 'react', fixedFrom: null, groups, counts, skill: null, suggestions: [], email: null, tookMs: 1,
});
const sample = result({
  people: [hit('people', 'Rama'), hit('people', 'Ravi')],
  orgs: [hit('orgs', 'React Hyderabad')],
  workspaces: [hit('workspaces', 'React kit'), hit('workspaces', 'a'), hit('workspaces', 'b'), hit('workspaces', 'c')],
}, { people: 2, orgs: 1, workspaces: 9 });

test('Discover puts organizations first; Network puts people first', () => {
  assert.deepEqual(buildBoxGroups(sample, 'discover').groups.map((g) => g.kind), ['orgs', 'workspaces', 'people']);
  assert.deepEqual(buildBoxGroups(sample, 'network').groups.map((g) => g.kind), ['people', 'orgs', 'workspaces']);
});

test('three rows a kind, See all when there are more', () => {
  const spaces = buildBoxGroups(sample, 'discover').groups.find((g) => g.kind === 'workspaces')!;
  assert.equal(spaces.rows.length, 3);
  assert.equal(spaces.count, 9);
  assert.equal(spaces.hasMore, true);
  assert.equal(spaces.label, 'Workspaces');
});

test('an exact name is the best match, shown once', () => {
  const exact = result({ people: [hit('people', 'Rama', 0), hit('people', 'Ramesh')], orgs: [hit('orgs', 'Rama Org', 1)] });
  const box = buildBoxGroups(exact, 'discover');
  assert.equal(box.best?.title, 'Rama');
  assert.deepEqual(box.groups.find((g) => g.kind === 'people')!.rows.map((r) => r.title), ['Ramesh']);
  assert.equal(box.flat[0]!.title, 'Rama');
});

test('keyboard order follows the screen', () => {
  const box = buildBoxGroups(sample, 'discover', { goto: [hit('goto', 'Appearance')] });
  assert.deepEqual(box.flat.map((r) => r.title), ['React Hyderabad', 'React kit', 'a', 'b', 'Rama', 'Ravi', 'Appearance']);
});

test('the place you are in comes first, named', () => {
  const scoped = result({ scope: [hit('scope', 'Heaps lab')], people: [hit('people', 'Rama')] });
  const box = buildBoxGroups(scoped, 'workspace', { placeName: 'CSE 3B' });
  assert.equal(box.groups[0]!.label, 'In CSE 3B');
  assert.equal(box.groups[1]!.label, 'People');
});

test('nothing at all says so', () => {
  assert.equal(buildBoxGroups(result({}), 'discover').total, 0);
  assert.equal(buildBoxGroups(sample, 'discover').total, 12);
});
