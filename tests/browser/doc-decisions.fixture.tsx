import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EditorView } from '@codemirror/view';
import { useEffect, useRef, useState } from 'react';

import { Toaster } from '@/components/ui/sonner';
import { DocDecisionsBlock } from '@/components/workspaces/doc/DocDecisions';
import { DocInsertMenu } from '@/components/workspaces/doc/DocInsertMenu';
import { WorkspaceDocRail } from '@/components/workspaces/doc/WorkspaceDocRail';
import { AddedWorkflowsContext } from '@/components/workspaces/workflows/useWorkspaceWorkflows';

// Report 38.3 F2 S4, W6, W7 (plan A0.6): a meeting's Decisions block, Record a decision, the rail's Decisions with
// D-numbers and the editor's Insert → Decisions. Server actions answer from window.__actions.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (url: string) => { w.__pushed = url; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Editor() {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  useEffect(() => {
    const v = new EditorView({ doc: '# Weekly', parent: host.current! });
    v.contentDOM.setAttribute('aria-label', 'Edit Weekly.md');
    w.__view = v;
    setView(v);
    return () => v.destroy();
  }, []);
  return (<div className="space-y-2"><div className="flex justify-end"><DocInsertMenu projectId="w1" nodeId="n1" view={view} /></div><div ref={host} className="rounded border border-border" /></div>);
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <AddedWorkflowsContext.Provider value={['meetings']}>
      <main className="mx-auto grid max-w-5xl gap-8 p-6 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="space-y-4">
          <Editor />
          <h1 className="nb-section-title">Weekly</h1>
          <DocDecisionsBlock projectId="w1" docSlug="weekly" canEdit />
        </div>
        <WorkspaceDocRail projectId="w1" activeSlug="weekly" canEdit />
      </main>
    </AddedWorkflowsContext.Provider>
    <Toaster />
  </QueryClientProvider>,
);
