import { notFound, redirect } from 'next/navigation'

import { AppealForm } from '@/components/trust/AppealForm'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { appealContext } from '@/lib/trust/appeals'
import { shortDate } from '@/lib/trust/messages'
import { ACTION_LABEL, caseLabel, parseCaseLabel, ruleLabel } from '@/lib/trust/rules'

export function generateMetadata() {
    return buildRouteMetadata({ title: 'Appeal · NetworkBase', description: 'Ask us to look again at a decision.', path: '/appeal', robots: { index: false, follow: false } })
}

/** The appeal form (docs/trust-and-safety-concept.md §10.3): every Appeal button in the app opens this page. */
export default async function AppealPage({ params }: { params: Promise<{ number: string }> }) {
    const raw = decodeURIComponent((await params).number)
    const { userId } = await getViewerAuthContext()
    if (!userId) redirect(`/login?next=${encodeURIComponent(`/appeal/${raw}`)}`)
    const number = parseCaseLabel(raw)
    const ctx = number ? await appealContext(userId, number) : null
    if (!ctx) notFound()
    const main = ctx.actions.find((a) => ['ban', 'suspension', 'limit', 'warning'].includes(a.action)) ?? ctx.actions[0]
    const what = [
        ctx.actions.map((a) => `${ACTION_LABEL[a.action]}${a.ends_at && ['limit', 'suspension'].includes(a.action) ? ` until ${shortDate(a.ends_at)}` : ''}`).join(' and '),
        main?.rule ? ruleLabel(main.rule) : null,
        main?.label ? `${main.label.charAt(0).toLowerCase()}${main.label.slice(1)} on ${shortDate(main.created_at)}` : null,
    ].filter(Boolean).join(' · ')
    return (
        <div data-scroll-root="route" className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter overscroll-y-contain bg-background">
        <main className="mx-auto w-full max-w-[64ch] px-4 py-10">
            <h1 className="nb-page-title text-foreground">Appeal {caseLabel(ctx.number)}</h1>
            <p className="nb-compact mt-3 text-foreground"><span className="font-medium">What happened:</span> {what}</p>
            <AppealForm caseNumber={caseLabel(ctx.number)} status={ctx.status} appealState={ctx.appealState} workspaceAction={ctx.workspaceAction}
                appealUntil={ctx.appealUntil ? shortDate(ctx.appealUntil) : null} />
        </main>
        </div>
    )
}
