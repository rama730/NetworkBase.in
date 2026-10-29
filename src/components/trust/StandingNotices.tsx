'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'

// What a restricted person sees (docs/trust-and-safety-concept.md §8.4, §8.6). Links are plain anchors: the app
// shell gate runs on a full load, so the appeal page opens even while everything else is closed.

const DISMISS_KEY = 'nb-standing-banner-dismissed'
const today = () => new Date().toISOString().slice(0, 10)

/** The strip at the top of every page while a limit or a workspace action lasts; ✕ hides it for the day. */
export function StandingBanner({ text, caseLabel, appealSent, canAppeal }: { text: string; caseLabel: string | null; appealSent: string | null; canAppeal: boolean }) {
    const [hidden, setHidden] = useState(true)
    useEffect(() => {
        try { setHidden(window.localStorage.getItem(DISMISS_KEY) === today()) } catch { setHidden(false) }
    }, [])
    if (hidden) return null
    return (
        <div role="status" className="flex items-start gap-2 border-b border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] px-4 py-2 text-[13px] text-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--status-warning)]" aria-hidden="true" />
            <p className="min-w-0 flex-1">
                {text}{' '}
                <a href="/settings#settings-account-standing" className="font-medium underline underline-offset-4">Why?</a>
                {appealSent ? <> · Appeal sent · We&apos;ll decide by {appealSent}</> : canAppeal && caseLabel ? <> · <a href={`/appeal/${caseLabel}`} className="font-medium underline underline-offset-4">Appeal</a></> : null}
            </p>
            <button type="button" aria-label="Hide for today" className="nb-touch-target -my-1 flex size-7 items-center justify-center rounded-[5px] hover:bg-muted"
                onClick={() => { setHidden(true); try { window.localStorage.setItem(DISMISS_KEY, today()) } catch { /* private mode */ } }}>
                <X className="size-4" aria-hidden="true" />
            </button>
        </div>
    )
}

/** Suspended or banned (8.6): nothing else opens. */
export function RestrictedScreen({ title, reason, email, caseLabel, appealSent, canAppeal }: { title: string; reason: string | null; email: string | null; caseLabel: string | null; appealSent: string | null; canAppeal: boolean }) {
    const { signOut } = useAuth()
    return (
        <main className="mx-auto flex min-h-[70vh] max-w-[520px] flex-col justify-center px-4 py-12">
            <h1 className="nb-page-title text-foreground">{title}</h1>
            {reason ? <p className="nb-body mt-3 text-foreground">Reason: {reason}{caseLabel ? <> · <span className="font-mono text-[13px]">{caseLabel}</span></> : null}</p> : null}
            {email ? <p className="nb-compact mt-1 text-muted-foreground">We sent the details to {email}.</p> : null}
            {appealSent ? <p className="nb-compact mt-3 text-foreground">Appeal sent · decision by {appealSent}</p> : null}
            <div className="mt-6 flex flex-wrap gap-2">
                {canAppeal && caseLabel && !appealSent ? <Button asChild><a href={`/appeal/${caseLabel}`}>Appeal</a></Button> : null}
                <Button asChild variant="outline"><a href="/api/v1/account/export" download>Download your data</a></Button>
                <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
            </div>
            <p className="nb-meta mt-8">Questions? Email support@networkbase.in{caseLabel ? ` and mention ${caseLabel}` : ''}.</p>
        </main>
    )
}
