import { renderShareImage } from '@/lib/sharing/social-image';
import { parseShareResource, shareOrigin } from '@/lib/sharing/presentation';
import { enforceRouteLimit } from '@/app/api/v1/_shared';

// An hour: a project made private must not keep its social card for a month (SEC-009 s-maxage=3600).
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limited = await enforceRouteLimit(request, 'share-image', 60, 60, 'publicRead');
  if (limited) return limited;
  const { slug } = await params;
  const resource = parseShareResource(new URL(`/projects/${encodeURIComponent(slug)}`, shareOrigin()).href);
  if (!resource) return new Response('Invalid workspace', { status:400,headers:{'Cache-Control':'no-store'} });
  return renderShareImage(resource.url);
}
