import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { SchoolYearSettings, ThisWeekAtSchool, YearView } from '@/components/organizations/SchoolYear';
import { YearMap } from '@/components/organizations/YearMap';
import { CurriculumOverview, StandardsView, TeachingSettings } from '@/components/organizations/Curriculum';
import { ClashNote, DeadlinesView, QuietWeeksSettings } from '@/components/organizations/StaffHandIns';
import { TimetableSettingsCard, TimetableView } from '@/components/organizations/Timetable';

// Plan B3.1a (report 32.2): Year view, Settings → School year, This week at school.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const view = new URLSearchParams(window.location.search).get('view') ?? 'year';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const O = '5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 1000, margin: '24px auto', padding: '0 16px' }}>{view === 'map' ? <YearMap schoolId={O} /> : view === 'tt-settings' ? <TimetableSettingsCard schoolId={O} /> : view === 'timetable' ? <TimetableView schoolId={O} /> : view === 'quiet' ? <QuietWeeksSettings schoolId={O} /> : view === 'deadlines' ? <DeadlinesView schoolId={O} /> : view === 'clash' ? <ClashNote schoolId={O} due="2026-10-09" target={{ mode: 'everyone' }} /> : view === 'teaching' ? <TeachingSettings schoolId={O} /> : view === 'standards' ? <StandardsView schoolId={O} /> : view === 'overview' ? <CurriculumOverview schoolId={O} /> : view === 'settings' ? <SchoolYearSettings orgId={O} /> : view === 'week' ? <ThisWeekAtSchool orgId={O} /> : <YearView orgId={O} />}</main>
    <Toaster />
  </QueryClientProvider>,
);
