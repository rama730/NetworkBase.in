import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FormProvider, useForm, useWatch } from 'react-hook-form';

import { Toaster } from '@/components/ui/sonner';
import { OrgWorkflowsCard } from '@/components/workspaces/workflows/OrgWorkflowsCard';
import { WizardWorkflowsField } from '@/components/workspaces/workflows/WizardWorkflowsField';
import { catalogEntry } from '@/lib/workflows/catalog';

// Report 38.2 W8 (S10) and W9 (S9), plan A0.3. Actions answer from window.__actions; Bugs and Roadmap stand in as built.
catalogEntry('bugs')!.built = true;
catalogEntry('roadmap')!.built = true;

function Wizard() {
  const params = new URLSearchParams(location.search);
  const form = useForm({ defaultValues: { project_type: params.get('category') ?? 'web_app', workflows: [] as string[] } });
  const picked = useWatch({ control: form.control, name: 'workflows' });
  return (
    <FormProvider {...form}>
      <main className="mx-auto max-w-xl p-6">
        <select aria-label="Category" value={useWatch({ control: form.control, name: 'project_type' })} onChange={(e) => form.setValue('project_type', e.target.value)}>
          <option value="web_app">Web app</option><option value="startup">Startup</option><option value="learning">Learning</option>
        </select>
        <WizardWorkflowsField orgId={params.get('org')} />
        <p data-testid="picked">{picked.join(',')}</p>
      </main>
    </FormProvider>
  );
}

const view = new URLSearchParams(location.search).get('view');
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    {view === 'wizard' ? <Wizard /> : <main className="mx-auto max-w-3xl p-6"><OrgWorkflowsCard orgId="o1" orgName="Northgate CS" /></main>}
    <Toaster />
  </QueryClientProvider>,
);
