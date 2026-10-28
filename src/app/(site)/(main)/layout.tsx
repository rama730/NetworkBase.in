import { Suspense } from 'react';
import type { User } from '@supabase/supabase-js';
import { MainLayout } from '@/components/layout/MainLayout';
import { MainRuntimeProviders } from '@/components/providers/MainRuntimeProviders';
import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { normalizeAuthNextPath } from '@/lib/auth/redirects';
import { hasCurrentLegalAcceptance } from '@/lib/legal/acceptance';
import { hasVerifiedMfaFactor } from '@/lib/auth/mfa-gate';
import { needsSecondFactor } from '@/lib/auth/mfa-ui';
import { hasCompletedOnboarding } from '@/lib/onboarding/completion';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

async function LegalAcceptanceGate({
  user,
  aal,
  children,
}: {
  user: User | null;
  aal: 'aal1' | 'aal2' | null;
  children: React.ReactNode;
}) {
  if (!user) return children;
  // ponytail: page-level gate; API routes still accept a password-only token. Add an aal check there for sensitive routes.
  const [onboarded, legalAccepted, secondFactorDue] = await Promise.all([
    hasCompletedOnboarding(user),
    hasCurrentLegalAcceptance(user.id),
    aal === 'aal2' ? false : hasVerifiedMfaFactor(user.id).then((has) => needsSecondFactor(aal, has)),
  ]);
  if (!onboarded || !legalAccepted || secondFactorDue) {
    const headerStore = await headers();
    const nextPath = normalizeAuthNextPath(
      headerStore.get('x-networkbase-request-target'),
    );
    if (secondFactorDue) {
      redirect(`/login?step=mfa&redirect=${encodeURIComponent(nextPath)}`);
    }
    if (!onboarded) {
      redirect(nextPath === '/discover' ? '/onboarding' : `/onboarding?next=${encodeURIComponent(nextPath)}`);
    }
    redirect(`/legal/accept?next=${encodeURIComponent(nextPath)}`);
  }

  return children;
}

export default async function MainRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, snapshot } = await getViewerAuthContext();

  return (
    <AuthRouteProviders initialUser={user} initialProfile={null}>
      <MainRuntimeProviders>
        <MainLayout>
          <Suspense fallback={<div className="h-full w-full bg-background" />}>
            <LegalAcceptanceGate user={user} aal={snapshot?.aal ?? null}>{children}</LegalAcceptanceGate>
          </Suspense>
        </MainLayout>
      </MainRuntimeProviders>
    </AuthRouteProviders>
  );
}
