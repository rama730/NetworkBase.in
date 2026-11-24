import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { DocsPrevNext, DocsSettingsPanel, DocsSiteMenu, DocsSiteToggle, OnThisPage } from "@/components/workspaces/doc/DocsSite";
import { NewSnippetDialog, SnippetsView } from "@/components/workspaces/doc/DocSnippets";
import type { WorkspaceDocListItem } from '@/lib/workspaces/doc';

// Report 38.15 W3/W4 (plan A6.34): the Docs site's three columns and Settings → Documents.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const params = new URLSearchParams(window.location.search);
const canEdit = params.get('edit') === '1';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const P = "5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
const doc = (slug: string, title: string, extra: Partial<WorkspaceDocListItem> = {}) => ({ id: slug, slug, filename: `${title}.md`, title, ...extra }) as WorkspaceDocListItem;
const docs = [doc('start', 'Getting started', { docsSite: true, docsOrder: 0 }), doc('guides', 'Guides', { docsSite: true, docsOrder: 1 }), doc('faq', 'FAQ', { docsSite: true, docsOrder: 2 }), doc('draft', 'Draft plan')];
const headings = [{ id: 'install', level: 2, text: 'Install' }, { id: 'sign-in', level: 2, text: 'Sign in' }, { id: 'first-task', level: 3, text: 'First task' }];

function Site() {
  const [active, setActive] = useState('guides');
  if (params.get('view') === 'snippets') return <SnippetsView projectId={P} canEdit={canEdit} onOpen={(slug) => { w.__opened = slug; }} />;
  if (params.get('view') === 'new-snippet') return <NewSnippetDialog projectId={P} open onOpenChange={() => undefined} />;
  return params.get('view') === 'settings' ? <DocsSettingsPanel workspaceId={P} /> : (
    <div style={{ display: "grid", gap: 32, gridTemplateColumns: "220px minmax(0,1fr) 200px" }}>
      <aside><DocsSiteMenu projectId={P} docs={docs} activeSlug={active} canEdit={canEdit} onOpen={setActive} /></aside>
      <main className="min-w-0">
        {canEdit ? <DocsSiteToggle projectId={P} docSlug={active} on={docs.find((d) => d.slug === active)?.docsSite === true} /> : null}
        <h1 className="text-2xl font-semibold">{docs.find((d) => d.slug === active)?.title}</h1>
        {headings.map((h) => <h2 key={h.id} id={h.id} className="mt-6 text-lg">{h.text}</h2>)}
        <DocsPrevNext docs={docs} activeSlug={active} onOpen={setActive} />
      </main>
      <aside><OnThisPage headings={headings} /></aside>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <div className="p-6"><Site /></div>
    <Toaster />
  </QueryClientProvider>,
);
