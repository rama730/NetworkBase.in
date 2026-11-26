import assert from 'node:assert/strict';
import test from 'node:test';
import type { SharePreview } from '../../src/lib/sharing/presentation';
import {
  PUBLIC_MARKDOWN_LIMIT, jsonLdHtml, profileJsonLd, profileMarkdown, readmeToPublicMarkdown,
  workspaceJsonLd, workspaceMarkdown, type PublicProfileSnapshot, type PublicWorkspaceSnapshot,
} from '../../src/lib/public-pages/text';

const base: SharePreview = {
  kind: 'project', state: 'ready', url: 'https://networkbase.in/workspaces/deepscope-ai',
  title: 'DeepScope AI', description: 'See Beyond the Surface of Any Website.',
  image: 'https://networkbase.in/api/og/workspace/deepscope-ai?v=abc', imageAlt: 'DeepScope AI', indexable: true,
  portfolio: null, skills: ['TypeScript', 'Next.js'], skillOverflow: 0, openToCollaborate: false,
  project: {
    team: [
      { id: '1', name: 'Asha Rao', username: 'asha', avatarUrl: null, role: 'Owner' },
      { id: '2', name: 'Hidden Handle', username: null, avatarUrl: null, role: 'Member' },
    ],
    teamOverflow: 0, roles: [{ id: 'r1', title: 'Frontend developer' }], roleOverflow: 0, views: 3, followers: 1,
  },
};

const workspace = (over: Partial<PublicWorkspaceSnapshot> = {}): PublicWorkspaceSnapshot => ({
  preview: base, kind: 'project', updatedAt: '2026-11-20T10:00:00.000Z',
  readme: { markdown: '## Setup\nRun it.', updatedAt: '2026-11-19T10:00:00.000Z' },
  updates: [{ id: 'u1', type: 'progress', text: 'Shipped the crawler.', author: 'Asha Rao', createdAt: '2026-11-18T10:00:00.000Z' }],
  ...over,
});

test('readme smart blocks are removed and inline references read as their label', () => {
  const md = 'Intro\n\n{% project.roles ids="a,b" %}\n\nAsk {% ref.contributors id="u1" label="Asha" %} today.';
  const out = readmeToPublicMarkdown(md);
  assert.equal(out.includes('{%'), false);
  assert.match(out, /Ask Asha today\./);
  assert.match(out, /^Intro/);
});

test('readme past the limit is cut with a truncated line', () => {
  const out = readmeToPublicMarkdown('x'.repeat(PUBLIC_MARKDOWN_LIMIT + 50));
  assert.ok(out.length <= PUBLIC_MARKDOWN_LIMIT + 20);
  assert.ok(out.endsWith('\n\n… (truncated)'));
});

test('workspace markdown has title, quote, source and the filled sections in order', () => {
  const out = workspaceMarkdown(workspace());
  assert.ok(out.startsWith('# DeepScope AI\n\n> See Beyond the Surface of Any Website.'));
  assert.match(out, /Source: https:\/\/networkbase\.in\/workspaces\/deepscope-ai/);
  const order = ['## Skills', '## Open roles', '## Team', '## README', '## Recent updates'].map((h) => out.indexOf(h));
  assert.ok(order.every((i) => i > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(out, /TypeScript, Next\.js/);
  assert.match(out, /Frontend developer/);
  assert.match(out, /\[Asha Rao\]\(https:\/\/networkbase\.in\/u\/asha\)/);
  assert.match(out, /Shipped the crawler\./);
});

test('workspace markdown leaves out empty sections', () => {
  const out = workspaceMarkdown(workspace({ readme: null, updates: [], preview: { ...base, skills: [], project: { ...base.project!, roles: [], team: [] } } }));
  for (const h of ['## Skills', '## Open roles', '## Team', '## README', '## Recent updates']) assert.equal(out.includes(h), false, h);
});

test('raw html in a readme stays literal text in the markdown copy', () => {
  const out = workspaceMarkdown(workspace({ readme: { markdown: '<script>alert(1)</script>', updatedAt: null } }));
  assert.match(out, /<script>alert\(1\)<\/script>/);
});

test('workspace json-ld describes a project as CreativeWork and an org as Organization', () => {
  const ld = workspaceJsonLd(workspace());
  assert.equal(ld['@type'], 'CreativeWork');
  assert.equal(ld.name, 'DeepScope AI');
  assert.equal(ld.description, 'See Beyond the Surface of Any Website.');
  assert.equal(ld.url, base.url);
  assert.equal(ld.image, base.image);
  assert.equal(ld.keywords, 'TypeScript, Next.js');
  assert.equal(ld.dateModified, '2026-11-20T10:00:00.000Z');
  assert.deepEqual(ld.isPartOf, { '@id': 'https://networkbase.in/#website' });
  assert.deepEqual(ld.contributor, [{ '@type': 'Person', name: 'Asha Rao', url: 'https://networkbase.in/u/asha' }]);
  assert.equal(workspaceJsonLd(workspace({ kind: 'organization' }))['@type'], 'Organization');
});

const profile: PublicProfileSnapshot = {
  preview: {
    ...base, kind: 'profile', url: 'https://networkbase.in/u/asha', title: 'Asha Rao (@asha) · NetworkBase', description: 'Builder',
    image: 'https://networkbase.in/api/og/profile/asha', skills: ['Go'], project: undefined,
    identity: { name: 'Asha Rao', username: 'asha', avatarUrl: null, headline: 'Builds crawlers' },
  },
  bio: 'I like search.', location: 'Pune', website: 'https://asha.dev',
  workspaces: [{ title: 'DeepScope AI', url: 'https://networkbase.in/workspaces/deepscope-ai', role: 'Owner' }],
};

test('profile json-ld is a ProfilePage about a Person', () => {
  const ld = profileJsonLd(profile);
  assert.equal(ld['@type'], 'ProfilePage');
  assert.deepEqual(ld.mainEntity, {
    '@type': 'Person', name: 'Asha Rao', alternateName: '@asha', description: 'Builds crawlers',
    url: 'https://networkbase.in/u/asha', image: 'https://networkbase.in/api/og/profile/asha', knowsAbout: ['Go'], sameAs: ['https://asha.dev'],
  });
  const noSite = profileJsonLd({ ...profile, website: null }).mainEntity as Record<string, unknown>;
  assert.equal('sameAs' in noSite, false);
});

test('profile markdown has name, bio and public workspaces', () => {
  const out = profileMarkdown(profile);
  assert.ok(out.startsWith('# Asha Rao (@asha)'));
  assert.match(out, /I like search\./);
  assert.match(out, /\[DeepScope AI\]\(https:\/\/networkbase\.in\/workspaces\/deepscope-ai\) · Owner/);
});

test('json-ld html cannot close its script tag', () => {
  const html = jsonLdHtml({ name: '</script><script>x' });
  assert.match(html, /\\u003c\/script/);
  assert.equal(html.includes('</script'), false);
});

test('a reference label with $ patterns stays literal (no replace-pattern expansion)', () => {
  const out = readmeToPublicMarkdown('A {% ref.contributors id="u1" label="$`$&$\'" %} B');
  assert.equal(out, "A $`$&$' B");
});

test('readme images become their alt text in the markdown copy', () => {
  const out = readmeToPublicMarkdown('Look ![Architecture diagram](https://evil.example/x.png "t") here and ![](https://x.example/y.png).');
  assert.equal(out, 'Look Architecture diagram here and .');
});
