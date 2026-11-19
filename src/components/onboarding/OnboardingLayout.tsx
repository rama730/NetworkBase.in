import { LegalLinks } from '@/components/legal/LegalLinks'

interface OnboardingLayoutProps {
  children: React.ReactNode
  /** The steps bar (logo + the four steps), pinned to the top. */
  steps?: React.ReactNode
  /** The ink panel on wide screens. */
  panel?: React.ReactNode
}

/**
 * The sign-in pages' frame: the form (the app's own fields) on paper under the steps bar, 9fr, and the ink panel that
 * builds your card, 7fr. Below 1024px: one column, and the card opens from the steps bar's Preview button.
 */
export function OnboardingLayout({ children, steps, panel }: OnboardingLayoutProps) {
  return (
    <div className="nb-onb onb-page" data-panel={panel ? 'true' : 'false'}>
      <div className="nb-onb-form">
        {steps}
        <div className="nb-onb-wrap">
          <main className="nb-onb-column">{children}</main>
        </div>
        <footer className="nb-onb-legal">
          <a href="mailto:support@networkbase.in?subject=Onboarding%20help" className="onb-link">Need help?</a>
          <LegalLinks showCopyright className="text-[11px]" />
        </footer>
      </div>
      {panel}
    </div>
  )
}
