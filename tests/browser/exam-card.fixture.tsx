import { createRoot } from 'react-dom/client';

import { ExamCard } from '@/components/organizations/ExamCard';

// Report 30.5 W4 (plan B1.6a): the exam on the student's copy.
const phase = new URLSearchParams(window.location.search).get('phase') ?? 'before';
const now = Date.now();
const exam = phase === 'open'
  ? { format: 'timed' as const, opensAt: new Date(now - 60 * 60_000).toISOString(), closesAt: new Date(now + 42 * 60_000).toISOString() }
  : { format: 'timed' as const, opensAt: new Date(now + 9 * 86_400_000).toISOString(), closesAt: new Date(now + 9 * 86_400_000 + 7_200_000).toISOString() };
createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 640, margin: '24px auto', padding: '0 16px' }}>
    <ExamCard exam={{ ...exam, room: 'LH-2 · 204', seats: 'By roll number', covers: { units: [], outcomes: [] }, hold: true, releasedAt: null }} coverNames={['Unit 1 Arrays', 'Unit 2 Trees']} rules={['Late work not accepted']} />
  </main>,
);
