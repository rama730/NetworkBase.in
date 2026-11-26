import { headers } from 'next/headers';
import { permanentRedirect } from 'next/navigation';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { readPublicWorkspaceSnapshot } from '@/lib/public-pages/snapshot';
import { jsonLdHtml, workspaceJsonLd } from '@/lib/public-pages/text';

// Plain page for search engines and AI readers: the same public content a signed-out person can open.
// No raw HTML (react-markdown escapes it), user links are nofollow ugc, README images become their alt text.
export const readmeComponents: Components = {
  a: ({ href, children }) => <a href={href} rel="nofollow ugc">{children}</a>,
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
};

export async function JsonLd({ data }: { data: Record<string, unknown> }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLdHtml(data) }} />;
}

export async function PublicWorkspaceArticle({ base, slug }: { base: '/workspaces' | '/org'; slug: string }) {
  const snap = await readPublicWorkspaceSnapshot(base, slug);
  const { preview } = snap;
  if (!('readme' in snap)) {
    return <article className="p-6"><h1>{preview.title}</h1><p>{preview.description}</p><a href={preview.state === 'ready' ? preview.url : '/discover'}>Open NetworkBase</a></article>;
  }
  if (new URL(preview.url).pathname !== `${base}/${slug}`) permanentRedirect(new URL(preview.url).pathname);
  const team = preview.project?.team ?? [];
  const roles = preview.project?.roles ?? [];
  return (
    <article className="mx-auto max-w-3xl p-6">
      <JsonLd data={workspaceJsonLd(snap)} />
      <h1>{preview.title}</h1>
      <p>{preview.description}</p>
      {preview.skills.length ? <section><h2>Skills</h2><p>{preview.skills.join(', ')}</p></section> : null}
      {roles.length ? <section><h2>Open roles</h2><ul>{roles.map((r) => <li key={r.id}>{r.title}</li>)}</ul></section> : null}
      {team.length ? (
        <section><h2>Team</h2><ul>{team.map((p) => (
          <li key={p.id}>{p.username ? <a href={`/u/${encodeURIComponent(p.username)}`}>{p.name}</a> : p.name}{p.role ? ` · ${p.role}` : ''}</li>
        ))}</ul></section>
      ) : null}
      {snap.readme ? <section><h2>README</h2><ReactMarkdown remarkPlugins={[remarkGfm]} components={readmeComponents}>{snap.readme.markdown}</ReactMarkdown></section> : null}
      {snap.updates.length ? (
        <section><h2>Recent updates</h2><ul>{snap.updates.map((u) => (
          <li key={u.id}><time dateTime={u.createdAt}>{u.createdAt.slice(0, 10)}</time>{u.author ? ` · ${u.author}` : ''}: {u.text}</li>
        ))}</ul></section>
      ) : null}
      <p><a href={preview.url}>Open on NetworkBase</a> · <a href={`${preview.url}.md`}>Markdown version</a></p>
    </article>
  );
}
