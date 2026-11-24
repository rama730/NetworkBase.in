import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { AssetViewer } from "@/components/workspaces/v2/files-tab/AssetViewer";

// Report 38.16 W3–W5 (plan A7.2): an asset opened large with pinned and timed comments.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const kind = new URLSearchParams(window.location.search).get('kind') ?? 'image';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const PIXEL = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#ddd"/></svg>');
// The fixture swaps the preview route for a local picture.
const realSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
Object.defineProperty(HTMLImageElement.prototype, 'src', { set(v: string) { realSrc.set!.call(this, v.startsWith('/api/') ? PIXEL : v); }, get() { return realSrc.get!.call(this); } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <AssetViewer projectId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" asset={kind === 'video' ? { id: 'v', name: 'Intro.mp4', mimeType: 'video/mp4', version: 3 } : { id: 'i', name: 'Logo.png', mimeType: 'image/png', version: 3 }} onClose={() => undefined} />
    <Toaster />
  </QueryClientProvider>,
);
