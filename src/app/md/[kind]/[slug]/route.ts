import { readPublicProfileSnapshot, readPublicWorkspaceSnapshot } from '@/lib/public-pages/snapshot';
import { profileMarkdown, workspaceMarkdown } from '@/lib/public-pages/text';
import type { SharePreview } from '@/lib/sharing/presentation';

// <public page>.md (rewritten here by src/proxy.ts): the same anonymous content as the reader article, as markdown.
const notAvailable = () => new Response("# Not available\n\nThis page is private or doesn't exist.\n",
  { status: 404, headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'private, max-age=0' } });

function markdown(path: string, preview: SharePreview, body: string) {
  if (new URL(preview.url).pathname !== path) return new Response(null, { status: 301, headers: { Location: `${preview.url}.md` } });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // Google indexes the HTML page; this copy is for AI readers.
      'X-Robots-Tag': 'noindex',
      Link: `<${preview.url}>; rel="canonical"`,
      'Cache-Control': 'private, max-age=0',
    },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; slug: string }> }) {
  const { kind, slug } = await params;
  const path = `/${kind}/${slug}`;
  if (kind === 'u') {
    const snap = await readPublicProfileSnapshot(slug);
    return 'bio' in snap && snap.preview.state === 'ready' ? markdown(path, snap.preview, profileMarkdown(snap)) : notAvailable();
  }
  if (kind === 'workspaces' || kind === 'org') {
    const snap = await readPublicWorkspaceSnapshot(kind === 'org' ? '/org' : '/workspaces', slug);
    return 'readme' in snap && snap.preview.state === 'ready' ? markdown(path, snap.preview, workspaceMarkdown(snap)) : notAvailable();
  }
  return notAvailable();
}
