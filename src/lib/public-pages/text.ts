import { parseWorkspaceDocInlineReferences, parseWorkspaceDocSmartBlocks } from '@/lib/workspaces/doc-blocks';
import type { SharePreview } from '@/lib/sharing/presentation';

export type PublicUpdate = { id: string; type: string | null; text: string; author: string | null; createdAt: string };
export type PublicWorkspaceSnapshot = {
  preview: SharePreview;
  kind: 'project' | 'organization';
  readme: { markdown: string; updatedAt: string | null } | null;
  updates: PublicUpdate[];
  updatedAt: string | null;
};
export type PublicProfileSnapshot = {
  preview: SharePreview;
  bio: string | null; location: string | null; website: string | null;
  workspaces: { title: string; url: string; role: string | null }[];
};

export const PUBLIC_MARKDOWN_LIMIT = 100_000;

const cap = (text: string) => text.length > PUBLIC_MARKDOWN_LIMIT ? text.slice(0, PUBLIC_MARKDOWN_LIMIT) + '\n\n… (truncated)' : text;
const origin = (preview: SharePreview) => new URL(preview.url).origin;
const personUrl = (preview: SharePreview, username: string) => `${origin(preview)}/u/${encodeURIComponent(username)}`;
const section = (title: string, body: string | null | undefined) => body ? `## ${title}\n\n${body}` : null;
const day = (iso: string | null) => iso?.slice(0, 10) ?? '';

/** README as plain markdown: app-only smart blocks dropped, inline references read as their label. */
export function readmeToPublicMarkdown(content: string): string {
  let out = content;
  for (const block of parseWorkspaceDocSmartBlocks(content)) out = out.replace(block.raw, '');
  for (const ref of parseWorkspaceDocInlineReferences(content)) out = out.replace(ref.raw, ref.label);
  return cap(out.replace(/\n{3,}/g, '\n\n').trim());
}

export function workspaceMarkdown(s: PublicWorkspaceSnapshot): string {
  const { preview } = s;
  const team = preview.project?.team ?? [];
  const roles = preview.project?.roles ?? [];
  return cap([
    `# ${preview.title}`,
    `> ${preview.description}`,
    `Source: ${preview.url}`,
    section('Skills', preview.skills.join(', ')),
    section('Open roles', roles.map((r) => `- ${r.title}`).join('\n')),
    section('Team', team.map((p) => `- ${p.username ? `[${p.name}](${personUrl(preview, p.username)})` : p.name}${p.role ? ` · ${p.role}` : ''}`).join('\n')),
    section('README', s.readme?.markdown),
    section('Recent updates', s.updates.map((u) => `- ${day(u.createdAt)}${u.author ? ` · ${u.author}` : ''}: ${u.text}`).join('\n')),
  ].filter(Boolean).join('\n\n') + '\n');
}

export function profileMarkdown(s: PublicProfileSnapshot): string {
  const { preview } = s;
  const name = preview.identity?.name ?? preview.title;
  const username = preview.identity?.username;
  return cap([
    `# ${name}${username ? ` (@${username})` : ''}`,
    preview.identity?.headline ? `> ${preview.identity.headline}` : null,
    `Source: ${preview.url}`,
    s.bio,
    [s.location ? `Location: ${s.location}` : null, s.website ? `Website: ${s.website}` : null].filter(Boolean).join('\n') || null,
    section('Skills', preview.skills.join(', ')),
    section('Workspaces', s.workspaces.map((w) => `- [${w.title}](${w.url})${w.role ? ` · ${w.role}` : ''}`).join('\n')),
  ].filter(Boolean).join('\n\n') + '\n');
}

export function workspaceJsonLd(s: PublicWorkspaceSnapshot): Record<string, unknown> {
  const { preview } = s;
  const people = (preview.project?.team ?? []).filter((p) => p.username)
    .map((p) => ({ '@type': 'Person', name: p.name, url: personUrl(preview, p.username!) }));
  return {
    '@context': 'https://schema.org',
    '@type': s.kind === 'organization' ? 'Organization' : 'CreativeWork',
    name: preview.title,
    description: preview.description,
    url: preview.url,
    image: preview.image,
    ...(preview.skills.length ? { keywords: preview.skills.join(', ') } : {}),
    ...(s.updatedAt ? { dateModified: s.updatedAt } : {}),
    ...(people.length ? { contributor: people } : {}),
    isPartOf: { '@id': `${origin(preview)}/#website` },
  };
}

export function profileJsonLd(s: PublicProfileSnapshot): Record<string, unknown> {
  const { preview } = s;
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: preview.url,
    mainEntity: {
      '@type': 'Person',
      name: preview.identity?.name ?? preview.title,
      ...(preview.identity?.username ? { alternateName: `@${preview.identity.username}` } : {}),
      ...(preview.identity?.headline ? { description: preview.identity.headline } : {}),
      url: preview.url,
      image: preview.image,
      ...(preview.skills.length ? { knowsAbout: preview.skills } : {}),
      ...(s.website ? { sameAs: [s.website] } : {}),
    },
  };
}

/** Next's JSON-LD guidance: escape `<` so user text can't close the script tag. */
export function jsonLdHtml(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
