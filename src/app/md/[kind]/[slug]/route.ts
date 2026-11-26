import { readPublicProfileSnapshot, readPublicWorkspaceSnapshot } from '@/lib/public-pages/snapshot';
import { profileMarkdown, workspaceMarkdown } from '@/lib/public-pages/text';

// <public page>.md (rewritten here by src/proxy.ts): the same anonymous content as the reader article, as markdown.
const NOT_AVAILABLE = "# Not available\n\nThis page is private or doesn't exist.\n";

export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; slug: string }> }) {
  const { kind, slug } = await params;
  if (kind !== 'workspaces' && kind !== 'org' && kind !== 'u') return new Response(NOT_AVAILABLE, { status: 404, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });

  const snap = kind === 'u' ? await readPublicProfileSnapshot(slug) : await readPublicWorkspaceSnapshot(kind === 'org' ? '/org' : '/workspaces', slug);
  const { preview } = snap;
  if (preview.state !== 'ready' || !('readme' in snap || 'bio' in snap)) {
    return new Response(NOT_AVAILABLE, { status: 404, headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'private, max-age=0' } });
  }
  if (new URL(preview.url).pathname !== `/${kind}/${slug}`) {
    return new Response(null, { status: 301, headers: { Location: `${preview.url}.md` } });
  }
  return new Response('readme' in snap ? workspaceMarkdown(snap) : profileMarkdown(snap), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      // Google indexes the HTML page; this copy is for AI readers.
      'X-Robots-Tag': 'noindex',
      Link: `<${preview.url}>; rel="canonical"`,
      'Cache-Control': 'private, max-age=0',
    },
  });
}
