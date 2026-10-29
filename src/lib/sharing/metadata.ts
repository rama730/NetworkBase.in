import type { Metadata } from 'next';
import { buildRouteMetadata } from '@/lib/metadata/route-metadata';
import { socialImageCanRender, type SharePreview } from './presentation';

export function shareMetadata(preview: SharePreview): Metadata {
  return buildRouteMetadata({ title: preview.title, description: preview.description, path: preview.url,
    image: preview.image, imageAlt: socialImageCanRender(preview) ? preview.imageAlt : `NetworkBase ${preview.kind === "project" ? "workspace" : preview.kind} link`, imageWidth: 1200, imageHeight: 630, imageType: 'image/png',
    openGraphType: preview.kind === 'profile' ? 'profile' : 'website',
    robots: preview.indexable ? { index: true, follow: true } : { index: false, follow: false, noarchive: true } });
}
