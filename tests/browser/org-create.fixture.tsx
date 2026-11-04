import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { OrgCalendarFields, OrgPeopleFields, OrgSettingsFields, OrgTypePicker } from '@/components/organizations/OrgWizardFields';
import { CreateLocationProvider } from '@/components/organizations/CreateLocation';
import { OrganizationCreatedScreen } from '@/components/organizations/OrganizationCreatedScreen';
import Phase2Information from '@/components/workspaces/create-wizard/phases/Phase2Information';

// Organization creation (report §34), one step per ?step=, on the real components and stylesheet.
const step = new URLSearchParams(location.search).get('step') ?? 'type';
const type = new URLSearchParams(location.search).get('type');

function Steps() {
    const methods = useForm({ defaultValues: {
        title: '', description: '', tags: [], project_type: 'organization', visibility: undefined, member_updates_enabled: true,
        organization: { org_type: type ?? undefined, handle: '', join_mode: 'instant', child_creation: 'members', outside_people: false },
    } as never });
    (window as unknown as { form: typeof methods }).form = methods;
    return (
        <FormProvider {...methods}>
            <CreateLocationProvider value={{ locations: [], locked: false, notice: null }}>
                <main className="p-4">
                    {step === 'type' ? <OrgTypePicker /> : null}
                    {step === 'details' ? <Phase2Information /> : null}
                    {step === 'people' ? <OrgPeopleFields /> : null}
                    {step === 'setup' ? <><OrgCalendarFields /><OrgSettingsFields /></> : null}
                </main>
            </CreateLocationProvider>
        </FormProvider>
    );
}

// The app wraps every page in a query client; Part of searches through it.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}>{step === 'done'
    ? <OrganizationCreatedScreen title="CSE-3A 2026" joinCode="K7M2QX" handle="cse-3a-2026" creatorTitle="Teacher" invites={{ coAdmins: 1, members: 62, skipped: 0 }} onContinue={() => undefined} />
    : <Steps />}</QueryClientProvider>);
