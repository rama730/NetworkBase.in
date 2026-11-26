import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { ageLabel, searchUrl } from '../../src/hooks/useGlobalSearch';

test('one GET with the words, the page and the place', () => {
  assert.equal(searchUrl({ q: 'react native', ctx: 'org', place: 'cse-3b', per: 3 }), '/api/v1/search?q=react+native&ctx=org&per=3&place=cse-3b');
  assert.equal(searchUrl({ q: 'ana', ctx: 'network', per: 60, only: 'people', exact: true, log: true }), '/api/v1/search?q=ana&ctx=network&per=60&only=people&exact=1&log=1');
});

test('how old the kept results are', () => {
  const now = Date.parse('2026-11-26T10:00:00Z');
  assert.equal(ageLabel(now - 20_000, now), 'a moment ago');
  assert.equal(ageLabel(now - 2 * 60_000, now), '2 minutes ago');
  assert.equal(ageLabel(now - 60_000, now), '1 minute ago');
  assert.equal(ageLabel(now - 3 * 3_600_000, now), '3 hours ago');
});

// Fast typing (Review Focus 3): each keystroke is its own query key, the old call is aborted, and the old answer
// stays on screen (dimmed) only until the new one comes; it can never replace a newer one.
test('drops stale responses: keyed by the words, aborted by signal, previous kept as placeholder', () => {
  const hook = readFileSync('src/hooks/useGlobalSearch.ts', 'utf8');
  assert.match(hook, /queryKeys\.globalSearch\.all\(/);
  assert.match(hook, /fetch\(url, \{ signal/);
  assert.match(hook, /placeholderData: keepPreviousData/);
  assert.match(hook, /useDebounce\(normalizeSearchQuery\(q\), 120\)/);
  assert.match(hook, /staleTime: 60_000/);
});
