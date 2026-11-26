import assert from 'node:assert/strict';
import test from 'node:test';
import { genericSharePreview, type SharePreview } from '../../src/lib/sharing/presentation';
import { shareMetadata } from '../../src/lib/sharing/metadata';

const ready: SharePreview = {
  ...genericSharePreview({ kind: 'project', identifier: 'deepscope-ai', url: 'https://networkbase.in/workspaces/deepscope-ai' }, 'ready'),
  title: 'DeepScope AI', description: 'See Beyond the Surface of Any Website.', indexable: true, entityKey: 'k1',
};

test('a ready workspace title carries the NetworkBase name once', () => {
  assert.equal(shareMetadata(ready).title, 'DeepScope AI · NetworkBase');
  assert.equal(shareMetadata({ ...ready, kind: 'profile', title: 'Asha (@asha) · NetworkBase' }).title, 'Asha (@asha) · NetworkBase');
});

test('a ready page points to its markdown copy and keeps its canonical', () => {
  const m = shareMetadata(ready);
  assert.equal((m.alternates?.types as Record<string, string>)['text/markdown'], 'https://networkbase.in/workspaces/deepscope-ai.md');
  assert.equal(m.alternates?.canonical, 'https://networkbase.in/workspaces/deepscope-ai');
});

test('an unavailable page has no markdown copy', () => {
  const m = shareMetadata({ ...ready, state: 'unavailable' });
  assert.equal(m.alternates?.types, undefined);
});

test('the placeholder preview for a person tab has no markdown copy', () => {
  const m = shareMetadata(genericSharePreview({ kind: 'project', identifier: 'x', url: 'https://networkbase.in/workspaces/x' }, 'ready'));
  assert.equal(m.alternates?.types, undefined);
});
