import { permanentRedirect } from 'next/navigation';
import { readPublicProfileSnapshot } from '@/lib/public-pages/snapshot';
import { profileJsonLd } from '@/lib/public-pages/text';
import { JsonLd } from './PublicWorkspaceArticle';

// Plain profile page for search engines and AI readers: only what a signed-out person can see.
export async function PublicProfileArticle({ username }: { username: string }) {
  const snap = await readPublicProfileSnapshot(username);
  const { preview } = snap;
  if (preview.state === 'ready' && new URL(preview.url).pathname !== `/u/${username}`) permanentRedirect(new URL(preview.url).pathname);
  if (!('bio' in snap)) {
    return <article className="p-6"><h1>{preview.title}</h1><p>{preview.description}</p><a href={preview.state === 'ready' ? preview.url : '/discover'}>Open NetworkBase</a></article>;
  }
  const identity = preview.identity;
  return (
    <article className="mx-auto max-w-3xl p-6">
      <JsonLd data={profileJsonLd(snap)} />
      <h1>{identity?.name ?? preview.title}{identity?.username ? ` (@${identity.username})` : ''}</h1>
      {identity?.headline ? <p>{identity.headline}</p> : null}
      {snap.bio ? <p>{snap.bio}</p> : null}
      {snap.location ? <p>Location: {snap.location}</p> : null}
      {snap.website ? <p>Website: <a href={snap.website} rel="nofollow ugc me">{snap.website}</a></p> : null}
      {preview.skills.length ? <section><h2>Skills</h2><p>{preview.skills.join(', ')}</p></section> : null}
      {snap.workspaces.length ? (
        <section><h2>Workspaces</h2><ul>{snap.workspaces.map((w) => (
          <li key={w.url}><a href={w.url}>{w.title}</a>{w.role ? ` · ${w.role}` : ''}</li>
        ))}</ul></section>
      ) : null}
      <p><a href={preview.url}>Open on NetworkBase</a> · <a href={`${preview.url}.md`}>Markdown version</a></p>
    </article>
  );
}
