import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DiscoverPeopleRail } from '@/components/discover/DiscoverPeopleRail';
import { DiscoverRail } from '@/components/discover/DiscoverRail';
import { AppScrollArea } from '@/components/ui/AppScrollArea';
import { ProfileShell } from '@/components/profile/v2/ProfileShell';
import { ProfileRightRail } from '@/components/profile/v2/ProfileRightRail';
import { OpenToRolesCard } from '@/components/profile/v2/sections/OpenToRolesCard';
import { Card } from '@/components/profile/v2/sections/Card';
import { DashboardTab } from '@/components/workspaces/tabs/DashboardTab';
import { ProfileRouteSkeleton } from '@/components/profile/v2/ProfileRouteSkeleton';
import { SkeletonDashboard } from '@/components/workspaces/skeletons/SkeletonDashboard';
import { PersonCardGrid } from '@/components/network/PersonCard';
import { PersonCardContent } from '@/components/network/PersonCardContent';
import { PersonCardSkeleton } from '@/components/network/PersonCardSkeleton';
import NetworkClient from '@/components/network/NetworkClient';
import { NetworkRouteSkeleton } from '@/components/network/NetworkRouteSkeleton';
import DiscoverHeader from '@/components/discover/DiscoverHeader';
import { parseDiscoverQuery, activeFilterCount } from '@/lib/discover/query';
import { DiscoverFiltersPanel } from '@/components/discover/DiscoverFiltersPanel';

const params = new URLSearchParams(location.search);
const owner = params.get('audience') !== 'visitor';
const empty = params.has('empty');
const surface = params.get('surface') || 'profile';
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
const fixture = (window as any).railsFixture = {
  events: [] as string[],
  activityFails: params.get('activity') === 'error',
  async readActivity() {
    if (params.get('activity') === 'loading') return new Promise<never>(() => {});
    if (fixture.activityFails) throw new Error('Fixture activity failure');
    if (empty) return [];
    return [{ id: 'member-1', type: 'member', text: 'Ada joined the workspace', href: '/workspaces/example?tab=team', occurredAt: '2026-10-14T12:00:00.000Z' }];
  },
};
const record = (event: string) => () => fixture.events.push(event);
const profile = {
  id: '11111111-1111-4111-8111-111111111111', username: 'builder', fullName: 'Builder',
  headline: 'Engineer', bio: 'I build things.', skills: [],
  socialLinks: empty ? {} : { github: 'https://github.com/builder', linkedin: 'https://www.linkedin.com/in/builder' },
  completionMissing: ['Add a photo'],
};
const roles = empty ? [] : ['Engineer', 'Designer', 'Researcher', 'Writer'].map((title, index) => ({
  id: `role-${index}`, title, count: 2, filled: 0, skills: [],
}));
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Fixture() {
  const [stage, setStage] = useState(1);
  const [discoverFiltersOpen, setDiscoverFiltersOpen] = useState(false);
  const [discoverQuery, setDiscoverQuery] = useState(parseDiscoverQuery(() => null));
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  return <QueryClientProvider client={client}>
    {['network-layout', 'network-loading', 'discover-layout'].includes(surface) ? <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: 56, flexShrink: 0 }}>NetworkBase</header>
      <div className="flex min-h-0 flex-1">
        <nav className="hidden shrink-0 md:block" style={{ width: 224 }} aria-label="Application navigation">Discover · Network</nav>
        <AppScrollArea data-testid="network-route-scroll" data-scroll-root="route" className={`min-h-0 min-w-0 flex-1 ${surface === 'discover-layout' ? 'px-4 sm:px-6' : ''}`}>
          {surface === 'network-layout' ? <NetworkClient initialUser={params.has('guest') ? null : { id: 'viewer' }} />
            : surface === 'network-loading' ? <NetworkRouteSkeleton />
              : <div className="mx-auto w-full max-w-[1240px] pb-8 pt-6"><div className="nb-discover-columns">
                <div><DiscoverHeader query={discoverQuery} activeFilters={activeFilterCount(discoverQuery)} announcement="" onChange={patch=>setDiscoverQuery({...discoverQuery,...patch})} onClearFilters={() => setDiscoverQuery(parseDiscoverQuery(() => null))} onOpenFilters={() => setDiscoverFiltersOpen(true)} filtersButtonRef={{ current: null }} /></div>
                <aside className="nb-discover-rail">People you should meet</aside>
              </div><DiscoverFiltersPanel open={discoverFiltersOpen} onOpenChange={setDiscoverFiltersOpen} query={discoverQuery} onChange={patch=>setDiscoverQuery({...discoverQuery,...patch})} onClear={()=>setDiscoverQuery(parseDiscoverQuery(() => null))} activeFilters={activeFilterCount(discoverQuery)} /></div>}
        </AppScrollArea>
      </div>
    </div> : surface === 'network-cards' ? <div className={params.has('unscoped') ? '' : 'nb-network-page'}>
      <div className="mx-auto max-w-[1000px] px-4 py-8 sm:px-6">
        <h1 className="nb-page-title">Network</h1>
        <PersonCardGrid items={['empty', 'rich', 'empty-2', 'loading', 'empty-3']} getKey={item => item}
          hasNextPage={false} isFetchingNextPage={false} fetchNextPage={() => {}} loadingLabel="Loading people"
          renderItem={item => item === 'loading' ? <PersonCardSkeleton /> : <PersonCardContent
            person={{id:item,username:'builder',fullName:'Builder',avatarUrl:null,
              headline:item==='rich'?(params.has('long')?'Long content that remains available on the profile. '.repeat(100):'Engineer specializing in interfaces.'):null,
              location:item==='rich'?'Lisbon':null,skills:item==='rich'?['React']:[],mutualConnections:item==='rich'?6:null}}
            action={<button className="nb-person-connect">Connect</button>} />}

        />
      </div>
    </div> : surface === 'sticky-profile' || surface === 'sticky-project' ? <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: 56, flexShrink: 0 }}>NetworkBase</header>
      <AppScrollArea data-testid="detail-page-scroll" data-scroll-root="route" className="min-h-0 flex-1">
        {surface === 'sticky-profile' ? <ProfileShell
          header={<h1 className="nb-page-title" style={{ height: 100 }}>Builder</h1>}
          tabs={<div>Overview · Portfolio</div>}
          main={<div data-testid="detail-main" style={{ height: 3000 }}>Profile overview</div>}
          highlights={<div data-testid="detail-rail-content" style={{ height: params.has('short') ? 200 : 1100 }} className="flex flex-col justify-between border border-border p-4">
            <h2>Role preferences</h2><a href="/my-profile/edit">Edit preferences</a>
          </div>} rail={null} />
          : <div data-testid="project-layout" style={{ '--project-tabs-height': '56px' } as React.CSSProperties}>
            <h1 className="nb-page-title px-6" style={{ height: 100 }}>Example project</h1>
            <nav data-testid="project-tabs" className="sticky top-0 z-30 bg-card px-6" style={{ height: 'var(--project-tabs-height)' }}>Dashboard · Docs</nav>
            <div data-testid="dashboard-fixture" className="p-6">
              <style>{`[data-testid="dashboard-fixture"] > div > div { min-height: 3000px; } [data-testid="dashboard-fixture"] aside[aria-label="Project details"] { min-height: ${params.has('short') ? 0 : 1100}px; }`}</style>
              <DashboardTab project={{ id: 'project-1', description: 'Project description' }}
                isCreator={owner} isCollaborator={false} rolesWithFilled={roles} onEdit={record('manage-roles')}
                lifecycleStages={['Plan', 'Build', 'Launch']} currentStageIndex={stage}
                onAdvanceStage={() => setStage(s => s + 1)} onApplyToRole={record('apply')} />
            </div>
          </div>}
      </AppScrollArea>
    </div> : surface === 'sticky-rail' ? <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: 56, flexShrink: 0 }}>NetworkBase</header>
      <AppScrollArea ref={setScrollRoot} data-testid="discover-feed-scroll" data-scroll-root="route" className="min-h-0 flex-1 px-6">
        <div className="mx-auto max-w-[1240px] pb-8 pt-6">
          <div className="nb-discover-columns">
            <main aria-label="Project feed">
              <h1 className="nb-page-title">Discover</h1>
              <div data-testid="feed-marker" className="h-10">Feed marker</div>
              <div style={{ height: 3000 }}>Scrollable projects</div>
            </main>
            <DiscoverRail scrollContainer={scrollRoot}>
              <div data-testid="rail-content" style={{ height: params.has('short') ? 200 : 1100 }} className="flex flex-col justify-between rounded-lg border border-border bg-card p-4">
                <h2>People you should meet</h2>
                <button onClick={() => { const content = document.querySelector<HTMLElement>('[data-testid="rail-content"]')!; content.style.height = '1400px'; }}>Expand rail content</button>
                <a href="/network?tab=suggested">Rail bottom</a>
              </div>
            </DiscoverRail>
          </div>
        </div>
      </AppScrollArea>
    </div> : surface === 'discover' ? <div className="mx-auto w-full max-w-[352px] p-4"><DiscoverPeopleRail variant={params.has('compact') ? 'compact' : 'desktop'} /></div>
      : surface === 'loading-profile' ? <ProfileRouteSkeleton />
        : surface === 'loading-project' ? <div className="mx-auto max-w-[1060px] p-6"><SkeletonDashboard /></div>
          : surface === 'project' ? <div className="mx-auto max-w-[1060px] p-4 sm:p-6">
            <h1 className="nb-page-title mb-6">Example project</h1>
            <DashboardTab project={{ id: 'project-1', description: 'Project description', problem: 'The problem', solution: 'The solution' }}
              isCreator={owner} isCollaborator={false} rolesWithFilled={roles} onEdit={record('manage-roles')}
              lifecycleStages={empty ? [] : ['Plan', 'Build', 'Launch']} currentStageIndex={stage}
              onAdvanceStage={() => { setStage(s => s + 1); fixture.events.push('advance'); }}
              onRedoStage={() => { setStage(s => s - 1); fixture.events.push('previous'); }}
              onApplyToRole={role => fixture.events.push(`apply:${role.id}`)}
              applicationStatus={params.get('status') === 'pending' ? { status: 'pending', roleId: 'role-0' } : { status: 'none' }} />
          </div> : <ProfileShell header={<h1 className="nb-page-title">Builder</h1>}
            tabs={<div className="border-b border-border pb-3">Overview · Portfolio</div>}
            main={<Card title="About"><p className="nb-body p-5">I build things.</p></Card>}
            highlights={<OpenToRolesCard isOwner={owner} openToCollaborate={!params.has('paused')}
              openTo={empty ? [] : ['Full-time roles', 'Freelance projects', 'Co-founder opportunities']} categories={empty ? [] : ['Design']}
              hoursPerWeek={empty ? undefined : 'h_5_10'} onEdit={record('edit-roles')}
              onInvite={record('invite')} onApply={record('apply-profile')} hasOpenRoles />}
            rail={<ProfileRightRail profile={profile} isOwner={owner} socialLinks={[]}
              onEditSection={section => fixture.events.push(`edit:${section}`)} />} />}
  </QueryClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
