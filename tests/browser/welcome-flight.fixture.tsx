import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout';
import { OnboardingSidebar } from '@/components/onboarding/OnboardingSidebar';
import { FinishScreen } from '@/components/onboarding/FinishScreen';
import { MainLayout } from '@/components/layout/MainLayout';
import { DiscoverRouteSkeleton } from '@/components/discover/DiscoverRouteSkeleton';
import { WelcomeFlightHost, preloadWelcomeFlight, startWelcomeFlight } from '@/components/onboarding/WelcomeFlight';
import { STEP_UI_CONFIG } from '@/lib/onboarding/step-ui-config';

// The pieces of the real app that matter to the flight, with a router the test can slow down: pushing a path
// swaps the page after window.__navDelay milliseconds, the way the real app swaps layouts.
const w = window as any;
let route = '/onboarding';
const subs = new Set<() => void>();
w.__pushed = [] as string[];
w.__router = {
  subscribe: (f: () => void) => { subs.add(f); return () => subs.delete(f); },
  get: () => route,
  push: (href: string) => {
    w.__pushed.push(href);
    setTimeout(() => { route = href.split('?')[0]!; subs.forEach((f) => f()); }, w.__navDelay ?? 300);
  },
};
w.__flightCalls = [] as unknown[];
w.__actions = {
  readSidebarWorkspacesAction: () => Promise.resolve({ orgs: [], requested: [], outside: [], personal: [], archived: [] }),
  recordWelcomeFlight: (input: unknown) => { w.__flightCalls.push(input); return Promise.resolve({ success: true }); },
};

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const steps = STEP_UI_CONFIG.map((c) => ({ title: c.sidebarLabel, subtitle: c.railHint }));

function Page() {
  const path = useSyncExternalStore(w.__router.subscribe, w.__router.get);
  if (path.startsWith('/onboarding')) {
    return (
      <OnboardingLayout sidebar={<OnboardingSidebar currentStep={0} stepLabels={steps} completedThrough={4} />}>
        <FinishScreen
          fullName="Ada Lovelace" username="ada" userId="u1" headline="Building the analytical engine" avatarUrl="" skills={['TypeScript']}
          visibility={w.__visibility ?? 'public'} continueLabel="Go to Discover"
          onContinue={(from) => {
            const started = startWelcomeFlight({ fullName: 'Ada Lovelace', username: 'ada', userId: 'u1', avatarUrl: '', visibility: w.__visibility ?? 'public', continuePath: '/discover', from });
            if (!started) w.__fallback = true;
          }}
        />
      </OnboardingLayout>
    );
  }
  return <MainLayout><DiscoverRouteSkeleton /></MainLayout>;
}

preloadWelcomeFlight().then(() => {
  createRoot(document.getElementById('root')!).render(
    <ThemeProvider><QueryClientProvider client={client}><TooltipProvider><Page /></TooltipProvider></QueryClientProvider><WelcomeFlightHost /></ThemeProvider>,
  );
});
