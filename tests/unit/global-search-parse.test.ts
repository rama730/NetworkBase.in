import assert from 'node:assert/strict';
import test from 'node:test';

import { contextFromPath, isEmailQuery, parseSearchInput } from '../../src/lib/search/global/parse';
import { matchScore, ORDER, splitMatch, TAB_ORDER } from '../../src/lib/search/global/rank';

test('typed shortcuts become a scope', () => {
  assert.deepEqual(parseSearchInput('@ ana'), { text: 'ana', scope: { kind: 'people' } });
  assert.deepEqual(parseSearchInput('#gen'), { text: 'gen', scope: { kind: 'channels' } });
  assert.deepEqual(parseSearchInput('in:cse-3b heaps'), { text: 'heaps', scope: { kind: 'in', place: 'cse-3b' } });
  assert.equal(parseSearchInput('> new workspace').scope?.kind, 'actions');
  assert.equal(parseSearchInput('> new workspace').text, 'new workspace');
  assert.deepEqual(parseSearchInput('  react  '), { text: 'react', scope: null });
});

test('match score: exact, prefix, word start, contains, none', () => {
  assert.equal(matchScore('React', 'react'), 0);
  assert.equal(matchScore('React Hyderabad', 'react'), 1);
  assert.equal(matchScore('Learn react', 'react'), 2);
  assert.equal(matchScore('Preactive', 'react'), 3);
  assert.equal(matchScore('Vue', 'react'), 4);
});

test('the page sets the order', () => {
  assert.equal(ORDER.discover[0], 'orgs');
  assert.equal(ORDER.network[0], 'people');
  assert.equal(ORDER.messages[0], 'messages');
  assert.equal(ORDER.settings[0], 'goto');
  assert.deepEqual(TAB_ORDER.network, ['people', 'discover', 'msgs', 'goto']);
  assert.equal(TAB_ORDER.messages[0], 'msgs');
});

test('the context comes from the address', () => {
  assert.deepEqual(contextFromPath('/org/cse'), { key: 'org', place: 'cse' });
  assert.deepEqual(contextFromPath('/workspaces/heaps'), { key: 'workspace', place: 'heaps' });
  assert.deepEqual(contextFromPath('/workspaces/new'), { key: 'discover', place: null });
  assert.equal(contextFromPath('/discover').key, 'discover');
  assert.equal(contextFromPath('/network?tab=x').key, 'network');
  assert.equal(contextFromPath('/messages/abc').key, 'messages');
  assert.equal(contextFromPath('/settings').key, 'settings');
  assert.equal(contextFromPath('/my-work').key, 'discover');
});

test('matched letters split out, case kept', () => {
  assert.deepEqual(splitMatch('Ananya Rao', 'ana'), { a: '', m: 'Ana', b: 'nya Rao' });
  assert.deepEqual(splitMatch('Vue', 'react'), { a: 'Vue', m: '', b: '' });
});

test('an email address is recognised', () => {
  assert.equal(isEmailQuery('ananya.rao@kl.edu'), true);
  assert.equal(isEmailQuery('react @ana'), false);
});
