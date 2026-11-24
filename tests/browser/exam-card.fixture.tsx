import { createRoot } from 'react-dom/client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ExamCard, ExamSettingsCard } from '@/components/organizations/ExamCard';

// Report 30.5 W4 (plan B1.6a): the exam on the student's copy.
const phase = new URLSearchParams(window.location.search).get('phase') ?? 'before';
const now = Date.now();
const exam = phase === 'open'
  ? { format: 'timed' as const, opensAt: new Date(now - 60 * 60_000).toISOString(), closesAt: new Date(now + 42 * 60_000).toISOString() }
  : { format: 'timed' as const, opensAt: new Date(now + 9 * 86_400_000).toISOString(), closesAt: new Date(now + 9 * 86_400_000 + 7_200_000).toISOString() };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(phase === 'settings' ? (
  <QueryClientProvider client={client}><main style={{ maxWidth: 640, margin: '24px auto', padding: '0 16px' }}><ExamSettingsCard orgId="5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" /></main></QueryClientProvider>
) : (
  <main style={{ maxWidth: 640, margin: '24px auto', padding: '0 16px' }}>
    <ExamCard exam={{ ...exam, room: 'LH-2 · 204', seats: 'By roll number', covers: { units: [], outcomes: [] }, hold: true, releasedAt: null }} coverNames={['Unit 1 Arrays', 'Unit 2 Trees']} rules={['Late work not accepted']} extraMinutes={phase === 'open' ? 30 : 0} />
  </main>
));
