import assert from 'node:assert/strict';
import test from 'node:test';
import nextConfig from '../../next.config';

// Old addresses live on in sent emails and bookmarks; each must land on its new home (report §5, §6.1, §12.2).
test('renamed pages redirect permanently from their old addresses', async () => {
  const redirects = await nextConfig.redirects!();
  const find = (source: string) => redirects.find((r) => r.source === source);
  assert.deepEqual(find('/workspace'), { source: '/workspace', destination: '/my-work', permanent: true });
  for (const [source, destination] of [
    ['/projects', '/workspaces'],
    ['/projects/:path*', '/workspaces/:path*'],
    ['/messages/p/:id', '/messages/w/:id'],
    ['/messages/p/:id/:path*', '/messages/w/:id/:path*'],
    ['/api/og/project/:path*', '/api/og/workspace/:path*'],
  ]) assert.deepEqual(find(source!), { source, destination, permanent: true }, source);
});
