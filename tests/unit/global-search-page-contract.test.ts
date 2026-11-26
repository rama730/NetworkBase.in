import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { openedKey, readOpened, rememberOpened } from '../../src/components/search/opened';

const read = (path: string) => readFileSync(path, 'utf8');
const page = () => read('src/app/(site)/(main)/search/page.tsx');
const client = () => read('src/components/search/SearchPageClient.tsx');

test('the page is server-rendered for a signed-in person, from the same search as the box', () => {
  const source = page();
  assert.match(source, /redirect\(`\/login\?next=\$\{encodeURIComponent\(/);
  assert.match(source, /runGlobalSearch\(\{[^}]*perKind: 60/);
  assert.match(source, /logSearch\(/);
  assert.match(source, /parseSearchPageState\(/);
});

test('the page follows the boards: tabs by page, facets, sort, cards or list, quick look, save, copy link, related', () => {
  const source = client();
  assert.match(source, /TAB_ORDER\[state\.ctx\]/);
  assert.match(source, /Results for “\{state\.q\}”/);
  assert.match(source, /Save search/);
  assert.match(source, /New matches: \{/);
  assert.match(source, /copyText\(/);
  assert.match(source, /Showing \{view\.shown\} of \{view\.tabTotal\}/);
  assert.match(source, /Related searches/);
  assert.match(source, /Only things tagged/);
  assert.match(source, /nextPeek\(/);
  assert.match(source, /Clear all/);
  // Filters change the address without asking the server again (Next keeps useSearchParams in step).
  assert.match(source, /window\.history\.replaceState\(/);
  assert.match(source, /data-scroll-root="route"/);
});

test('no header band and no coloured edge accents', () => {
  const css = read('src/components/search/search-page.css');
  assert.doesNotMatch(client(), /band/i);
  assert.doesNotMatch(css, /border-left: [2-4]px solid|inset [2-4]px 0 0/);
});

test('back puts you where you were: the opened card is marked again', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  rememberOpened(storage, 'q=react&tab=people', 'person:1');
  assert.equal(readOpened(storage, 'q=react&tab=people'), 'person:1');
  assert.equal(readOpened(storage, 'q=react'), null);
  assert.equal(openedKey('q=react'), 'nb-search-opened:q=react');
  assert.match(client(), /rememberOpened\(/);
  assert.match(client(), /readOpened\(/);
});
