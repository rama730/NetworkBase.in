import { renderShareImage } from '@/lib/sharing/social-image';
import { profileSharePath, shareOrigin } from '@/lib/sharing/presentation';
import { enforceRouteLimit } from '@/app/api/v1/_shared';

export async function GET(request: Request, { params }: { params: Promise<{ username: string }> }) {
  const limited = await enforceRouteLimit(request, 'share-image', 60, 60, 'publicRead');
  if (limited) return limited;
  const { username } = await params;
  const path = profileSharePath(username);
  if (!path) return new Response('Invalid profile', { status:400,headers:{'Cache-Control':'no-store'} });
  return renderShareImage(new URL(path, shareOrigin()).href);
}
