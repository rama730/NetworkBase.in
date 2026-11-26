import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { parseSearchParams } from '../../src/lib/search/global/params';

const params = (value: string) => parseSearchParams(new URLSearchParams(value));

test('the box sends q, ctx, place and per; defaults fill the rest', () => {
  assert.deepEqual(params('q=%20react%20&ctx=network'), { ok: true, value: { q: 'react', ctx: 'network', place: null, per: 3, exact: false, log: false, scope: null } });
  assert.equal(params('q=react&ctx=org&place=cse-3b&per=999').ok && params('q=react&ctx=org&place=cse-3b&per=999').value.per, 60);
  const typed = params('q=%40ana&ctx=discover');
  assert.ok(typed.ok);
  assert.deepEqual(typed.ok && typed.value.scope, { kind: 'people' });
  assert.equal(typed.ok && typed.value.q, 'ana');
});

test('a chosen kind from the Search only chips', () => {
  const only = params('q=react&ctx=discover&only=posts');
  assert.deepEqual(only.ok && only.value.scope, { kind: 'only', only: 'posts' });
});

test('bad input is refused, not guessed', () => {
  assert.equal(params('q=react&ctx=nowhere').ok, false);
  assert.equal(params('ctx=discover').ok, false);
  assert.equal(params(`q=${'a'.repeat(101)}&ctx=discover`).ok, false);
  assert.equal(params('q=react&ctx=discover&only=everything').ok, false);
});

test('the route is a signed-in GET with a rate limit and a 60 s private cache', () => {
  const route = readFileSync('src/app/api/v1/search/route.ts', 'utf8');
  assert.match(route, /export async function GET/);
  assert.match(route, /requireAuthenticatedUser\(\)/);
  assert.match(route, /enforceRouteLimit\(request, "api:v1:search"/);
  assert.match(route, /private, max-age=60/);
  assert.doesNotMatch(route, /"use server"/);
});
