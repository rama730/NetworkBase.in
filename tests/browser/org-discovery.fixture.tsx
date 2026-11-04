import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrgOnDiscover, OrgVerifiedBadge, OrgWebAddress } from '@/components/organizations/OrgDiscoverySections';
import { SettingsCard } from '@/components/workspaces/settings/SettingsFormFields';
import { Toaster } from '@/components/ui/sonner';
import type { OrgDetail } from '@/lib/organizations/detail';

// Settings → Visibility and discovery (2026-11-05-org-address-discovery-verification-findings.md §4, §5), one
// organization state per ?case=, as owner or ?role=admin.
const params = new URLSearchParams(location.search);
const scenario = params.get('case') ?? 'waiting';
const role = (params.get('role') ?? 'owner') as 'owner' | 'admin';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const base = {
  type: 'education', typeLabel: 'Education', partOf: null, location: null, memberCount: 1, childProjectCount: 0, suspended: false, suspendReason: null, archived: false,
  deletionScheduledAt: null, verified: false, verificationRequested: false, verificationOutcome: null, hasWebsite: false, handleRenameAvailableAt: null,
  createdAt: '2026-10-31T00:00:00Z', hasDescription: false, discoverHidden: false, verifiedAt: null, verificationMethod: null, verifiedLabel: null,
  verificationPending: null, partOfOrg: null, proofCode: 'networkbase-verify-0123456789abcdef0123',
} as unknown as OrgDetail;

const cases: Record<string, { org: Partial<OrgDetail>; visibility?: string }> = {
  waiting: { org: {} },
  listed: { org: { hasDescription: true, childProjectCount: 1, memberCount: 2, partOfOrg: { id: 'p', title: 'Northgate Institute', slug: 'northgate', verified: true } } },
  private: { org: {}, visibility: 'private' },
  suspended: { org: { suspended: true } },
  hidden: { org: { discoverHidden: true, hasDescription: true, memberCount: 3 } },
  archived: { org: { archived: true } },
  email: { org: { verificationPending: { method: 'email', masked: 'h…@rvce.edu.in', expiresAt: '2026-11-05T10:10:00Z', waitSeconds: 3 } } },
  parent: { org: { verificationPending: { method: 'parent', parentTitle: 'Northgate Institute', at: '2026-11-05T10:00:00Z' } } },
  team: { org: { verificationPending: { method: 'team', at: '2026-11-05T10:00:00Z' } } },
  verified: { org: { verified: true, hasDescription: true, verificationMethod: 'email', verifiedLabel: 'Verified · rvce.edu.in', verifiedAt: '2026-11-05T10:00:00Z' } },
  declined: { org: { verificationOutcome: { state: 'declined', reason: 'We couldn’t reach the department.', at: '2026-11-05T10:00:00Z' } } },
};
const c = cases[scenario] ?? cases.waiting!;
const organization = { ...base, ...c.org } as OrgDetail;
const go = (id: string) => { (window as unknown as { opened: string[] }).opened.push(id); };
(window as unknown as { opened: string[] }).opened = [];

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main style={{ padding: 16, maxWidth: 900 }}>
      <SettingsCard title="Visibility and discovery" headingLevel={2} description="Who can find the organization, and how.">
        <div className="divide-y divide-border">
          <div className="py-6"><OrgOnDiscover organization={organization} visibility={c.visibility ?? 'public'} handle="cse-3b-data-structures-2026" onOpenSection={go} /></div>
          <div className="py-6"><OrgWebAddress orgId="org" organization={organization} role={role} handle="cse-3b-data-structures-2026" /></div>
          <div className="py-6"><OrgVerifiedBadge orgId="org" organization={organization} role={role} onOpenSection={go} /></div>
        </div>
      </SettingsCard>
    </main>
    <Toaster />
  </QueryClientProvider>,
);
