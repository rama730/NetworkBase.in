import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { LabProtocolsCard, ProtocolPanel } from '@/components/organizations/LabProtocols';
import { LabNotebook } from '@/components/organizations/LabNotebook';
import { LabEquipmentCard } from '@/components/organizations/LabEquipment';
import { LabPaperReviews, WorkspacePapers } from '@/components/organizations/LabPapers';
import { LabLibrary } from '@/components/organizations/LabLibrary';
import { LabMeetingCard } from '@/components/organizations/LabMeeting';
import { LabProgressCard, MyProgressCard } from '@/components/organizations/LabProgress';
import { LabAboutSections, LabHomeCard, LabPeople, LabSettingsCard, MyAlumniCard } from '@/components/organizations/Lab';

// Plan B6.1a (report 35.2): a lab's People, home card and Settings → Lab.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const view = new URLSearchParams(window.location.search).get('view');
const orgId = '7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }}>
      {view === 'progress' ? <><MyProgressCard orgId={orgId} /><LabProgressCard orgId={orgId} /></> : view === 'meeting' ? <LabMeetingCard orgId={orgId} /> : view === 'library' ? <LabLibrary orgId={orgId} /> : view === 'reviews' ? <LabPaperReviews orgId={orgId} /> : view === 'papers' ? <WorkspacePapers workspaceId="9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" /> : view === 'equipment' ? <LabEquipmentCard orgId={orgId} /> : view === 'notebook' ? <LabNotebook workspaceId="9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" /> : view === 'protocol' ? <ProtocolPanel orgId={orgId} docId="8f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" /> : view === 'protocols' ? <LabProtocolsCard orgId={orgId} /> : view === 'about' ? <LabAboutSections orgId={orgId} /> : view === 'alumni-card' ? <MyAlumniCard orgId={orgId} /> : view === 'settings' ? <LabSettingsCard orgId={orgId} /> : view === 'home' ? <LabHomeCard orgId={orgId} slug="vision-lab" /> : <LabPeople orgId={orgId} roster={null} />}
    </main>
    <Toaster />
  </QueryClientProvider>,
);
