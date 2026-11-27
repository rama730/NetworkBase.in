import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { ClubMeetingCard, CommitteeCard, ConstitutionCard, DecisionsCard, ElectionCard, MotionVotesCard, HandoverCard, RecruitingBanner, RecruitingCard, RenewalCard } from '@/components/organizations/Club';

// Plan B7.1a (report 36.2): Recruiting now, the officers' Recruiting card and the join poster.
const w = window as any;
const subs = new Set<() => void>();
w.__router = { subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); }, get: () => '/', push: (to: string) => { w.__pushed = to; } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const O = '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f';
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px' }} className="space-y-4">
      <RecruitingBanner orgId={O} />
      <RecruitingCard orgId={O} />
      <RenewalCard orgId={O} />
      <CommitteeCard orgId={O} />
      <CommitteeCard orgId={O} about />
      <ElectionCard orgId={O} />
      <HandoverCard orgId={O} />
      <ClubMeetingCard orgId={O} />
      <ConstitutionCard orgId={O} />
      <DecisionsCard orgId={O} />
      <MotionVotesCard orgId={O} />
    </main>
    <Toaster />
  </QueryClientProvider>,
);
