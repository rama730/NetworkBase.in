import { Suspense } from 'react';
import type { User } from '@supabase/supabase-js';
import { MainLayout } from '@/components/layout/MainLayout';
import { StandingGate } from '@/components/trust/StandingGate';
import { MainRuntimeProviders } from '@/components/providers/MainRuntimeProviders';
import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { normalizeAuthNextPath } from '@/lib/auth/redirects';
import { hasCurrentLegalAcceptance } from '@/lib/legal/acceptance';
import { hasCompletedOnboarding } from '@/lib/onboarding/completion';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

async function LegalAcceptanceGate({
  user,
  children,
}: {
  user: User | null;
  children: React.ReactNode;
}) {
  if (!user) return children;
  const [onboarded, legalAccepted] = await Promise.all([
    hasCompletedOnboarding(user),
    hasCurrentLegalAcceptance(user.id),
  ]);
  if (!onboarded || !legalAccepted) {
    const headerStore = await headers();
    const nextPath = normalizeAuthNextPath(
      headerStore.get('x-networkbase-request-target'),
    );
    if (!onboarded) {
      redirect(nextPath === '/discover' ? '/onboarding' : `/onboarding?next=${encodeURIComponent(nextPath)}`);
    }
    redirect(`/legal/accept?next=${encodeURIComponent(nextPath)}`);
  }

  const path = normalizeAuthNextPath((await headers()).get('x-networkbase-request-target'));
  return <StandingGate userId={user.id} email={user.email} path={path}>{children}</StandingGate>;
}

export default async function MainRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getViewerAuthContext();

  return (
    <AuthRouteProviders initialUser={user} initialProfile={null}>
      <MainRuntimeProviders>
        <MainLayout>
          <Suspense fallback={<div className="h-full w-full bg-background" />}>
            <LegalAcceptanceGate user={user}>{children}</LegalAcceptanceGate>
          </Suspense>
        </MainLayout>
      </MainRuntimeProviders>
    </AuthRouteProviders>
  );
}
