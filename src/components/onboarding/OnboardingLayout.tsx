interface OnboardingLayoutProps {
  children: React.ReactNode
  sidebar?: React.ReactNode
  mobileProgress?: React.ReactNode
}

/**
 * Split-pane shell. Desktop (≥1024px): a 248px progress rail beside a 608px form column. Below that: one
 * column under a progress bar that stays pinned while the step scrolls.
 */
export function OnboardingLayout({ children, sidebar, mobileProgress }: OnboardingLayoutProps) {
  return (
    <div className="onb-page min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="onb-progress-rail sticky top-0 hidden h-dvh overflow-y-auto border-r border-border lg:block">
        {sidebar}
      </aside>

      <section className="min-w-0">
        <div className="sticky top-0 z-30 lg:hidden">{mobileProgress}</div>
        <main className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full flex-col px-4 pb-8 pt-10 md:min-h-dvh md:max-w-[560px] md:px-6 md:pb-10 md:pt-12 lg:max-w-[608px] lg:px-6 lg:pt-16">
          {children}
        </main>
      </section>
    </div>
  )
}
