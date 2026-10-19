'use client';

import { parseShareResource } from '@/lib/sharing/presentation';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import type { LinkPreviewData } from './preview-data';
import type { PreviewDisplayAuthorization } from './display-authorization';

export type PreviewSnapshot = {
  preview: LinkPreviewData | null;
  authorization: PreviewDisplayAuthorization | null;
  deadline: number;
  wallDeadline: number;
};

/** Known loss of access must win over an in-flight renewal. No raw identity is broadcast. */
export function maskLinkPreviewAccess(client: QueryClient, resourceKey?: string) {
  const filters = { queryKey: queryKeys.sharing.linksRoot(), predicate: (query: { queryKey: readonly unknown[]; state: { data: unknown } }) => {
    const data = query.state.data as PreviewSnapshot | undefined;
    return resourceKey ? data?.authorization?.resourceKey === resourceKey
      || data?.preview?.firstParty?.entityKey === resourceKey
      : Boolean(data?.preview?.firstParty || typeof query.queryKey[4] === 'string' && parseShareResource(query.queryKey[4]));
  } };
  void client.cancelQueries(filters, { revert: false });
  client.setQueriesData<PreviewSnapshot>(filters, old => old?.authorization
    ? { ...old, authorization: null, deadline: 0, wallDeadline: 0 } : old);
}

export function invalidateLinkPreviewAccess(client: QueryClient, resourceKey?: string) {
  maskLinkPreviewAccess(client, resourceKey);
  return client.invalidateQueries({ queryKey: queryKeys.sharing.linksRoot(), predicate: query => {
    const data = query.state.data as PreviewSnapshot | undefined;
    return !resourceKey || data?.preview?.firstParty?.entityKey === resourceKey
      || data?.preview?.firstParty?.url === resourceKey;
  } });
}
