import { notFound } from 'next/navigation'

import { OnboardingPreview } from '@/components/onboarding/OnboardingPreview'

/**
 * A local-only visual harness. The route is unavailable in production and
 * does not mount the authenticated onboarding provider.
 */
export default function OnboardingPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return <OnboardingPreview />
}
