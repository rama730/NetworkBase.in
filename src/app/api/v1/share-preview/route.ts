import { NextRequest } from 'next/server';
import { enforceRouteLimit, jsonError, jsonSuccess } from '@/app/api/v1/_shared';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { parseShareResource, shareOrigin } from '@/lib/sharing/presentation';
import { readSharePreview } from '@/lib/sharing/read';

export async function GET(request: NextRequest) {
  const limited = await enforceRouteLimit(request, 'share-preview', 60, 60, 'publicRead');
  if (limited) return limited;
  const url = request.nextUrl.searchParams.get('url') ?? '';
  const origin = shareOrigin(request.url);
  if (!parseShareResource(url, origin)) return jsonError('A valid NetworkBase sharing link is required.', 400, 'BAD_REQUEST');
  const { userId } = await getViewerAuthContext();
  const publicPreview = await readSharePreview(url, null, origin);
  const viewerPreview = userId ? await readSharePreview(url, userId, origin) : publicPreview;
  return jsonSuccess({ publicPreview, viewerPreview, viewerId: userId }, undefined,
    { headers: { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Authorization' } });
}
