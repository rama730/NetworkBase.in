import assert from 'node:assert/strict';
import test from 'node:test';
import { markdownRewritePath } from '../../src/lib/public-pages/markdown-path';

test('a public page address plus .md maps to the markdown route', () => {
  assert.equal(markdownRewritePath('/workspaces/deepscope-ai.md'), '/md/workspaces/deepscope-ai');
  assert.equal(markdownRewritePath('/org/cse-3b.md'), '/md/org/cse-3b');
  assert.equal(markdownRewritePath('/u/asha_rao.md'), '/md/u/asha_rao');
});

test('anything else is left alone', () => {
  for (const path of ['/workspaces/x.md/extra', '/workspaces/.md', '/workspaces/a/b.md', '/workspaces/../x.md', '/workspaces/x',
    '/settings/x.md', '/u/x.y.md', '/workspaces/%2e%2e.md', `/workspaces/${'a'.repeat(201)}.md`, '/md/workspaces/x']) {
    assert.equal(markdownRewritePath(path), null, path);
  }
});
