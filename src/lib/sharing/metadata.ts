import type { Metadata } from 'next';
import { buildRouteMetadata } from '@/lib/metadata/route-metadata';
import { socialImageCanRender, type SharePreview } from './presentation';

export function shareMetadata(preview: SharePreview): Metadata {
  // Search results name the site the way GitHub's do: "<name> · NetworkBase".
  const title = /NetworkBase$/.test(preview.title) ? preview.title : `${preview.title} · NetworkBase`;
  const metadata = buildRouteMetadata({ title, description: preview.description, path: preview.url,
    image: preview.image, imageAlt: socialImageCanRender(preview) ? preview.imageAlt : `NetworkBase ${preview.kind === "project" ? "workspace" : preview.kind} link`, imageWidth: 1200, imageHeight: 630, imageType: 'image/png',
    openGraphType: preview.kind === 'profile' ? 'profile' : 'website',
    robots: preview.indexable ? { index: true, follow: true } : { index: false, follow: false, noarchive: true } });
  // A ready workspace, org or profile has a plain markdown copy for AI readers at the same address + .md.
  if (preview.state === 'ready' && preview.entityKey && preview.kind !== 'application') {
    metadata.alternates = { ...metadata.alternates, types: { 'text/markdown': `${preview.url}.md` } };
  }
  return metadata;
}
