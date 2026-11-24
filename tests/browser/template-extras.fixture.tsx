import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { BmcCanvas, DocTemplateTools, GoalsNumbers } from "@/components/workspaces/doc/DocTemplateTools";
import { AddedWorkflowsContext } from "@/components/workspaces/workflows/added-workflows";
import { templateById } from "@/lib/workflows/doc-templates";

// Report 38.15 call 3, 4, 7 (plan A6.36): the template tools, the canvas grid and the goals numbers.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view') ?? 'test-plan';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const P = "5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
const CONTENT: Record<string, string> = {
  'test-plan': `| Case | Steps | Expected | Result | Tester | Date |\n|---|---|---|---|---|---|\n| SSO with Google | Open, pick Google | Lands on My work | Pass | | |\n| Expired token | Wait, reload | Asks again | Fail | | |\n| Offline | | | Blocked | | |\n`,
  'assumptions-check': `| Assumption | Depends on | Evidence | If it’s wrong, what breaks | Cheapest test | Status |\n|---|---|---|---|---|---|\n| Teachers want it | | Weak | All | Ask 5 teachers | Broken |\n| Schools will pay | Teachers want it | Weak | Pricing | 5 calls | Testing |\n`,
  'prd': `# PRD – SSO\n\n## Requirements\n| Requirement | Priority (Must / Should / Could) | Roadmap item |\n|---|---|---|\n| Google SSO | Must | |\n| Dark mode | Could | |\n\n## User stories\n- As a teacher I want SSO so that I sign in once\n`,
};
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <AddedWorkflowsContext.Provider value={['bugs', 'roadmap']}>
      <main className="max-w-3xl p-6">
        {view === 'bmc' ? <BmcCanvas content={templateById('business-model-canvas')!.body} />
          : view === 'goals' ? <GoalsNumbers projectId={P} />
          : <DocTemplateTools projectId={P} docSlug="doc" template={view} content={CONTENT[view]!} />}
      </main>
    </AddedWorkflowsContext.Provider>
    <Toaster />
  </QueryClientProvider>,
);
