import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToRegexp } from 'next/dist/compiled/path-to-regexp';
import nextConfig from '../../next.config';

// Old addresses live on in sent emails and bookmarks; each must land on its new home (report §5, §6.1, §12.2).
test('renamed pages redirect permanently from their old addresses', async () => {
  const redirects = await nextConfig.redirects!();
  const find = (source: string) => redirects.find((r) => r.source === source);
  assert.deepEqual(find('/workspace'), { source: '/workspace', destination: '/my-work', permanent: true });
  for (const [source, destination] of [
    ['/projects/:path*', '/workspaces/:path*'],
    ['/messages/p/:id/:path*', '/messages/w/:id/:path*'],
    ['/api/og/project/:path*', '/api/og/workspace/:path*'],
  ]) assert.deepEqual(find(source!), { source, destination, permanent: true }, source);
  // `:path*` also matches zero segments, so the bare old addresses need no entry of their own.
  for (const [source, path] of [['/projects/:path*', '/projects'], ['/messages/p/:id/:path*', '/messages/p/abc']]) {
    assert.ok(pathToRegexp(source!, [], {}).test(path!), path);
  }
});
