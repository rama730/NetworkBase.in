'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { extractFirstUrl, useLinkPreview } from '@/hooks/useLinkPreview';
import { parseShareResource } from '@/lib/sharing/presentation';
import { LinkPreviewCard } from './LinkPreviewCard';

/** Visibility gates each observer; another visible occurrence keeps its shared query active. */
export const MessageLinkPreview = memo(function MessageLinkPreview({ body, onRemove }: { body: string; onRemove?: () => void }) {
  const url = useMemo(() => extractFirstUrl(body), [body]);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const preview = useLinkPreview(url, { active: visible });
  if (!url) return null;
  const resource = parseShareResource(url);
  const data = preview.data ?? (preview.isLoading ? { url, domain: new URL(url).hostname, title: null, description: null, image: null } : null);
  return <div ref={setElement} className="msg-link-preview-boundary">
    {data ? <LinkPreviewCard preview={data} loading={preview.isLoading} onRemove={onRemove} /> : null}
    {resource && (preview.isPaused || preview.data?.firstParty?.state === 'unknown') && !preview.isLoading
      ? <button type="button" className="nb-compact mt-1 min-h-9 text-primary" disabled={!visible || preview.isPaused || preview.isFetching}
          onClick={() => void preview.refetch()}>Retry preview</button> : null}
  </div>;
});
