import { Suspense } from 'react';
import type { User } from '@supabase/supabase-js';
import { MainLayout } from '@/components/layout/MainLayout';
import { MainRuntimeProviders } from '@/components/providers/MainRuntimeProviders';
import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { normalizeAuthNextPath } from '@/lib/auth/redirects';
import { hasCurrentLegalAcceptance } from '@/lib/legal/acceptance';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

async function LegalAcceptanceGate({
  user,
  children,
}: {
  user: User | null;
  children: React.ReactNode;
}) {
  if (user && !(await hasCurrentLegalAcceptance(user.id))) {
    const headerStore = await headers();
    const nextPath = normalizeAuthNextPath(
      headerStore.get('x-networkbase-request-target'),
    );
    redirect(`/legal/accept?next=${encodeURIComponent(nextPath)}`);
  }

  return children;
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
