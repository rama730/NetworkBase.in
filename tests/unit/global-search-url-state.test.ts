import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFilters, nextPeek, parseSearchPageState, serializeSearchPageState, toggleFacet } from '../../src/lib/search/global/url-state';
import type { GlobalSearchResult, SearchHit } from '../../src/lib/search/global/types';

const hit = (kind: SearchHit['kind'], title: string, extra: Partial<SearchHit> = {}): SearchHit => ({
  id: `${kind}:${title}`, kind, title, sub: '', href: `/${title}`, why: null, score: 3, createdAt: '2026-11-25T00:00:00Z', avatarUrl: null, tags: [], act: null, meta: {}, ...extra,
});
const DAY = 86_400_000;
const now = Date.parse('2026-11-26T12:00:00Z');
const result: GlobalSearchResult = {
  q: 'react', fixedFrom: null, skill: null, suggestions: [], email: null, tookMs: 1,
  groups: {
    orgs: [hit('orgs', 'React Hyderabad', { tags: ['React'], meta: { orgType: 'community', followers: 900 } })],
    workspaces: [
      hit('workspaces', 'React kit', { tags: ['React', 'TypeScript'], meta: { openToCollaborate: true, openRoles: 2, followers: 10 }, createdAt: new Date(now - 2 * DAY).toISOString() }),
      hit('workspaces', 'Old app', { tags: ['Vue'], meta: { followers: 50 }, createdAt: new Date(now - 60 * DAY).toISOString() }),
    ],
    posts: [hit('posts', 'Ananya', { sub: 'react hooks', createdAt: new Date(now - DAY).toISOString() })],
    people: [
      hit('people', 'Ravi', { tags: ['React'], meta: { relKey: 'any', mutual: 0, location: 'Chennai' } }),
      hit('people', 'Ananya', { tags: ['React', 'Figma'], meta: { relKey: 'conn', mutual: 4, location: 'Hyderabad', openCollab: true } }),
    ],
    messages: [
      hit('messages', 'Sana', { meta: { place: '#frontend', author: 'Sana', hasFile: true } }),
      hit('messages', 'Rama', { meta: { place: '#frontend', author: 'Rama', hasFile: false } }),
    ],
  },
  counts: { orgs: 1, workspaces: 2, posts: 1, people: 2, messages: 2 },
};

test('the address holds every tab, filter and sort, and only what differs from the default', () => {
  const state = parseSearchPageState(new URLSearchParams('q=react&tab=people&skill=React&loc=Hyderabad,Chennai&sort=1&view=list'));
  assert.equal(state.tab, 'people');
  assert.deepEqual(state.skills, ['React']);
  assert.deepEqual(state.loc, ['Hyderabad', 'Chennai']);
  assert.equal(state.view, 'list');
  assert.equal(serializeSearchPageState(state), 'q=react&tab=people&skill=React&loc=Hyderabad%2CChennai&sort=1&view=list');
  assert.equal(serializeSearchPageState(parseSearchPageState(new URLSearchParams('q=react'))), 'q=react');
  assert.equal(parseSearchPageState(new URLSearchParams('q=x&tab=nowhere&sort=-4&more=999')).tab, 'discover');
  assert.equal(parseSearchPageState(new URLSearchParams('q=x&more=999')).more, 20);
});

test('tab counts and Discover groups with heads', () => {
  const view = applyFilters(result, parseSearchPageState(new URLSearchParams('q=react')), [], now);
  assert.deepEqual(view.tabCounts, { discover: 4, people: 2, msgs: 2, goto: 0 });
  assert.deepEqual(view.rows.filter((r) => r.type === 'head').map((r) => r.type === 'head' && r.label), ['Organizations', 'Workspaces', 'Posts']);
});

test('facet counts come from the match before filters; zero options stay, greyed', () => {
  const filtered = applyFilters(result, parseSearchPageState(new URLSearchParams('q=react&skill=TypeScript')), [], now);
  const skills = filtered.facets.find((f) => f.key === 'skill')!;
  assert.equal(skills.opts.find((o) => o.value === 'React')!.count, 2);
  assert.equal(skills.opts.find((o) => o.value === 'TypeScript')!.on, true);
  const titles = filtered.rows.filter((r) => r.type === 'hit').map((r) => r.type === 'hit' && r.hit.title);
  assert.deepEqual(titles, ['React kit']);
  const updated = applyFilters(result, parseSearchPageState(new URLSearchParams('q=react&updated=week')), [], now);
  assert.equal(updated.facets.find((f) => f.key === 'otype')!.opts[0]!.label, 'Community');
  assert.deepEqual(updated.chips.map((c) => c.label), ['Past week']);
});

test('people: Most mutuals sorts, Your connections filters, relationship facet counts', () => {
  const sorted = applyFilters(result, parseSearchPageState(new URLSearchParams('q=react&tab=people&sort=1')), [], now);
  assert.equal(sorted.sortLabel, 'Most mutuals');
  assert.equal(sorted.rows[0]!.type === 'hit' && sorted.rows[0]!.hit.title, 'Ananya');
  const conn = applyFilters(result, parseSearchPageState(new URLSearchParams('q=react&tab=people&rel=conn')), [], now);
  assert.equal(conn.rows.length, 1);
  assert.equal(conn.facets.find((f) => f.key === 'rel')!.opts.find((o) => o.value === 'conn')!.count, 1);
});

test('messages are grouped under their conversation; Has a file filters', () => {
  const view = applyFilters(result, parseSearchPageState(new URLSearchParams('q=react&tab=msgs')), [], now);
  assert.equal(view.rows[0]!.type, 'conv');
  assert.equal(view.rows.filter((r) => r.type === 'conv').length, 1);
  const files = applyFilters(result, parseSearchPageState(new URLSearchParams('q=react&tab=msgs&file=1')), [], now);
  assert.equal(files.rows.filter((r) => r.type === 'hit').length, 1);
});

test('toggling a facet resets Show more and quick look', () => {
  const state = { ...parseSearchPageState(new URLSearchParams('q=react&more=2')), peek: 'x' };
  const next = toggleFacet(state, 'skill', 'React');
  assert.deepEqual(next.skills, ['React']);
  assert.equal(next.more, 0);
  assert.deepEqual(toggleFacet(next, 'skill', 'React').skills, []);
  assert.equal(toggleFacet(state, 'rel', 'conn').rel, 'conn');
  assert.equal(toggleFacet(state, 'file', '1').file, true);
});

test('show more: six at a time', () => {
  const many: GlobalSearchResult = { ...result, groups: { people: Array.from({ length: 13 }, (_, i) => hit('people', `P${i}`)) }, counts: { people: 13 } };
  const first = applyFilters(many, parseSearchPageState(new URLSearchParams('q=p&tab=people')), [], now);
  assert.equal(first.shown, 6);
  assert.equal(first.tabTotal, 13);
  assert.equal(applyFilters(many, parseSearchPageState(new URLSearchParams('q=p&tab=people&more=1')), [], now).shown, 12);
});

test('quick look keys: j/k wrap, Space toggles, Esc closes', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(nextPeek(ids, null, 'j'), 'a');
  assert.equal(nextPeek(ids, 'c', 'j'), 'a');
  assert.equal(nextPeek(ids, 'a', 'k'), 'c');
  assert.equal(nextPeek(ids, 'b', ' '), null);
  assert.equal(nextPeek(ids, null, ' '), 'a');
  assert.equal(nextPeek(ids, 'b', 'Escape'), null);
  assert.equal(nextPeek([], null, 'j'), null);
});

// Phase 3 review 7: counts follow every other filter you picked; an option with nothing left goes grey.
test('facet counts update as you pick (each facet counts with the others applied)', () => {
  const view = applyFilters(result, parseSearchPageState(new URLSearchParams('q=react&updated=week')), [], now);
  const open = view.facets.find((f) => f.key === 'open')!.opts[0]!;
  assert.equal(open.count, 1);
  const month = applyFilters(result, parseSearchPageState(new URLSearchParams('q=react&skill=Vue')), [], now);
  const week = month.facets.find((f) => f.key === 'updated')!.opts.find((o) => o.value === 'week')!;
  assert.equal(week.count, 0);
  assert.equal(week.zero, true);
});

// Phase 3 review 9: one head per conversation, however the messages interleave.
test('messages are grouped under their conversation even when they interleave', () => {
  const mixed: GlobalSearchResult = { ...result, groups: { messages: [
    hit('messages', 'a', { meta: { place: '#one' } }), hit('messages', 'b', { meta: { place: '#two' } }),
    hit('messages', 'c', { meta: { place: '#one' } }), hit('messages', 'd', { meta: { place: '#two' } }),
  ] }, counts: { messages: 4 } };
  const view = applyFilters(mixed, parseSearchPageState(new URLSearchParams('q=x&tab=msgs')), [], now);
  assert.deepEqual(view.rows.filter((r) => r.type === 'conv').map((r) => r.type === 'conv' && r.label), ['#one', '#two']);
  assert.deepEqual(view.rows.filter((r) => r.type === 'hit').map((r) => r.type === 'hit' && r.hit.title), ['a', 'c', 'b', 'd']);
});
