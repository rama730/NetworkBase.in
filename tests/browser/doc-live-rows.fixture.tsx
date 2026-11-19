import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef, useState } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { DocInsertMenu } from '@/components/workspaces/doc/DocInsertMenu';
import { RemovedListsNote, WorkspaceDocLiveBlock } from '@/components/workspaces/doc/WorkspaceDocLiveBlock';

// Report 38.3 F2 S3, S5, W3–W5, W10 (plan A0.5): a live task-rows block, the editor's Insert menu and the removed-lists
// note. Server actions answer from window.__actions.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: () => undefined };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Editor() {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  useEffect(() => {
    const v = new EditorView({ doc: '# Weekly\n\nNotes here', parent: host.current! });
    v.contentDOM.setAttribute('aria-label', 'Edit Weekly.md');
    w.__view = v;
    setView(v);
    return () => v.destroy();
  }, []);
  return (
    <div className="space-y-2">
      <div className="flex justify-end"><DocInsertMenu projectId="w1" nodeId="n1" view={view} /></div>
      <div ref={host} className="rounded border border-border" />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <Editor />
      <WorkspaceDocLiveBlock projectId="w1" projectSlug="team" docSlug="weekly" blockKey="k7f3" label="Action items" />
      <RemovedListsNote projectId="w1" projectSlug="team" docSlug="weekly" presentKeys={['k7f3']} />
    </main>
    <Toaster />
  </QueryClientProvider>,
);
