import assert from 'node:assert/strict';
import test from 'node:test';
import { isAnonymousReaderRequest, markdownRewritePath } from '../../src/lib/public-pages/markdown-path';

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

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

test('readers of public pages and every .md copy are served without the session', () => {
  for (const path of ['/workspaces/deepscope-ai', '/org/cse-3b', '/u/asha']) assert.equal(isAnonymousReaderRequest(path, GOOGLEBOT), true, path);
  for (const ua of [CHROME, GOOGLEBOT, 'curl/8.7.1', null]) assert.equal(isAnonymousReaderRequest('/workspaces/deepscope-ai.md', ua), true, String(ua));
});

test('a person in a browser, and app paths, keep their session', () => {
  assert.equal(isAnonymousReaderRequest('/workspaces/deepscope-ai', CHROME), false);
  for (const path of ['/settings/profile', '/messages', '/api/v1/me', '/my-work/', '/']) assert.equal(isAnonymousReaderRequest(path, GOOGLEBOT), false, path);
});
