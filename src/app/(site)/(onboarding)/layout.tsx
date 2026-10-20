import '@/styles/onboarding-tokens.css';
import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders';
import { getViewerProfileContext } from '@/lib/server/viewer-context';
import { OnboardingBootstrapProvider } from '@/components/onboarding/OnboardingBootstrapProvider';
import { db } from '@/lib/db';
import { onboardingDrafts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { hasCompletedOnboarding } from '@/lib/onboarding/completion';
import { clampCompletedThrough, clampOnboardingStep } from '@/lib/onboarding/state';
import { parseOnboardingDraft } from '@/lib/validations/onboarding';
import { validateUsername, normalizeUsername } from '@/lib/validations/username';

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, emailVerified } = await getViewerProfileContext();
  if (!user) redirect('/login?redirect=/onboarding');
  if (!emailVerified) redirect('/verify-email');
  // Same definition of "done" as every other gate, checked before any draft is read.
  if (await hasCompletedOnboarding(user)) redirect('/discover');

  let draft = await db.query.onboardingDrafts.findFirst({
    where: eq(onboardingDrafts.userId, user.id),
    columns: { step: true, completedThrough: true, version: true, draft: true },
    extras: (fields, { sql }) => ({ expired: sql<boolean>`${fields.expiresAt} <= now()`.as('expired') }),
  });
  // An expired draft is deleted, not just ignored: left in place its version would conflict with the
  // fresh one the browser starts, and the old answers would come back over what the person typed.
  if (draft?.expired) {
    await db.delete(onboardingDrafts).where(eq(onboardingDrafts.userId, user.id));
    draft = undefined;
  }

  const data = parseOnboardingDraft(draft?.draft);
  // The handle picked on the sign-up form is where the person expects to start from.
  const signupUsername = normalizeUsername(String(user.user_metadata?.username ?? ''));
  if (!data.username && validateUsername(signupUsername).valid) data.username = signupUsername;

  const bootstrap = {
    userId: user.id,
    draft: {
      step: clampOnboardingStep(draft?.step),
      completedThrough: clampCompletedThrough(draft?.completedThrough),
      version: draft?.version ?? 0,
      data,
    },
  } as const;

  return (
    <AuthRouteProviders initialUser={user} initialProfile={profile}>
      <OnboardingBootstrapProvider value={bootstrap}>
        {children}
      </OnboardingBootstrapProvider>
    </AuthRouteProviders>
  );
}
