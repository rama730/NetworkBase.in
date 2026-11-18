'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { captureMessage } from '@sentry/nextjs'

import Logo from '@/components/layout/header/Logo'
import { BackButton } from '@/components/layout/header/BackButton'
import { PixelIcon } from '@/components/auth/pixel'
import { Button } from '@/components/ui/button'
import { buildAuthPageHref } from '@/lib/auth/redirects'
import { notFoundContextAction } from '@/app/actions/not-found'
import { suggestAddress, type Suggestion } from '@/lib/errors/suggest'
import { readRecentPages, type RecentPage } from '@/lib/navigation/recent-pages'
import { shortTitle } from '@/lib/navigation/back-routes'

// 404 and error pages (prototype 18oAc8rbMB6hRsYTj2dxDy). Same rule as the sign-in pages: the controls are the app's own,
// the look (grid, pixel code, typed address, serif headline, button ring) comes from the marketing page.

type Trail = { refresh(): void; destroy(): void }

/** The grid under a full-page error, with the big pixel code drawn by the shared engine (loaded after the page). */
function useGridStage(ref: React.RefObject<HTMLElement | null>) {
    const trail = useRef<Trail | null>(null)
    useEffect(() => {
        let gone = false
        void import('@/lib/grid-trail').then(({ attachGridTrail }) => {
            if (gone || !ref.current) return
            trail.current = attachGridTrail(ref.current, 'hero')
            void document.fonts?.ready.then(() => trail.current?.refresh())
        })
        return () => { gone = true; trail.current?.destroy(); trail.current = null }
    }, [ref])
    return trail
}

type NotFoundContext = { signedIn: boolean; place: Suggestion | null }
/**
 * Asked only once a 404 is on screen (Next sends not-found files with every page, so they must cost nothing there):
 * signed in or not, and the closest of the viewer's own places. Skipped when the page already knows and it can't help.
 */
function useNotFoundContext(path: string, known?: boolean): NotFoundContext | null {
    const [context, setContext] = useState<NotFoundContext | null>(known === undefined ? null : { signedIn: known, place: null })
    useEffect(() => {
        if (!path) return
        const section = path.split('/')[1]
        if (known !== undefined && !(known && (section === 'workspaces' || section === 'org'))) return
        let live = true
        notFoundContextAction(path).then(
            (result) => { if (live) setContext(result) },
            () => { if (live) setContext((current) => current ?? { signedIn: false, place: null }) },
        )
        return () => { live = false }
    }, [path, known])
    return context
}

/**
 * Long addresses shortened in the middle so the line stays on one line (shorter on phones). Everything up to the
 * mistyped part is kept, so the correction always has its word to fix.
 */
function shortPath(path: string, phone: boolean, keep = '') {
    const max = phone ? 24 : 44
    if (path.length <= max) return path
    const head = keep && path.includes(keep) ? path.slice(0, path.indexOf(keep) + keep.length) : ''
    if (!head) return `${path.slice(0, Math.ceil(max / 2) - 1)}…${path.slice(-Math.floor(max / 2) + 1)}`
    const room = max - head.length - 1
    return room >= 4 ? `${head}…${path.slice(-room)}` : `${head}…`
}

/**
 * The address that wasn't found, typed in like the marketing terminal. With a suggestion it corrects itself: the wrong
 * part is erased and the right one typed in green. Reduced motion shows the end state.
 */
function TypedAddress({ path, fix }: { path: string; fix: Suggestion | null }) {
    const [html, setHtml] = useState<ReactNode>(null)
    useEffect(() => {
        const phone = window.innerWidth < 640
        const shown = shortPath(path.replace(/^\//, ''), phone, fix?.from)
        const at = fix ? shown.indexOf(fix.from) : -1
        const fixed = (head: string, word: string, tail: string) => <>{head}<span className="nb-err-fixed">{word}</span>{tail}</>
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setHtml(at >= 0 ? fixed(shown.slice(0, at), fix!.to, shown.slice(at + fix!.from.length)) : shown)
            return
        }
        let gone = false
        const steps: (() => void)[] = []
        for (let n = 1; n <= shown.length; n++) steps.push(() => setHtml(shown.slice(0, n)))
        if (at >= 0) {
            const head = shown.slice(0, at), tail = shown.slice(at + fix!.from.length)
            for (let i = 0; i < 30; i++) steps.push(() => undefined) // a beat before the correction
            for (let n = fix!.from.length; n >= 0; n--) steps.push(() => setHtml(head + fix!.from.slice(0, n) + tail))
            for (let n = 1; n <= fix!.to.length; n++) steps.push(() => setHtml(fixed(head, fix!.to.slice(0, n), tail)))
        }
        let i = 0
        const timer = setInterval(() => { if (gone || i >= steps.length) return clearInterval(timer); steps[i++]!() }, 24)
        return () => { gone = true; clearInterval(timer) }
    }, [path, fix])
    return <b aria-hidden="true">{html}</b>
}

/** A 404 reached from one of our own pages is our broken link: recorded for us, nothing on screen. */
function reportBrokenLink(from: string | null) {
    const to = window.location.pathname
    if (!from || from === to) return
    try {
        captureMessage('nav.broken_link', { level: 'warning', fingerprint: ['broken-link', from, to], extra: { from, to } })
    } catch {
        // Monitoring must never break the page.
    }
}

/** Enter (outside a field or a button) goes to the suggestion, or the main action. */
function useEnterTo(href: string | null) {
    const router = useRouter()
    useEffect(() => {
        if (!href) return
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== 'Enter' || event.defaultPrevented || (event.target as Element | null)?.closest?.('input, textarea, select, button, a, [contenteditable="true"]')) return
            event.preventDefault()
            router.push(href)
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
    }, [href, router])
}

/** Focus starts on the headline, so a screen reader announces "Error 404. This page isn’t here." first. */
function useHeadingFocus() {
    const ref = useRef<HTMLHeadingElement | null>(null)
    useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [])
    return ref
}

function useRecentPages() {
    const [pages, setPages] = useState<RecentPage[]>([])
    useEffect(() => setPages(readRecentPages(window.location.pathname)), [])
    return pages
}

function RecentlyVisited({ pages }: { pages: RecentPage[] }) {
    if (!pages.length) return null
    return (
        <nav className="nb-err-recent" aria-label="Recently visited">
            <p className="nb-err-label">Recently visited</p>
            <ul>
                {pages.map((page) => {
                    const parts = page.title.split(' · ').map((p) => p.trim()).filter((p) => p && p !== 'NetworkBase')
                    return <li key={page.path}><Link href={page.path}>{parts[0] ?? shortTitle(page.title)}{parts[1] ? <span> · {parts[1]}</span> : null}</Link></li>
                })}
            </ul>
        </nav>
    )
}

function SuggestionBox({ fix }: { fix: Suggestion }) {
    return (
        <p className="nb-err-suggest">
            <span className="text-muted-foreground">Did you mean</span>
            {fix.kind === 'section'
                ? <Link className="nb-err-suggest-path" href={fix.path}>networkbase / {fix.path.replace(/^\//, '')}</Link>
                : <Link className="nb-err-suggest-place" href={fix.path}><span className="nb-err-mark" aria-hidden="true">{fix.title.slice(0, 2).toUpperCase()}</span>{fix.title}</Link>}
        </p>
    )
}

function TopBar({ fallback }: { fallback: string }) {
    return (
        <header className="nb-auth-top">
            <div className="nb-err-back"><BackButton fallback={fallback} /></div>
            <div className="nb-auth-logo"><Logo /></div>
        </header>
    )
}

function Footer() {
    return (
        <footer className="nb-err-foot">
            <span>© {new Date().getFullYear()} NetworkBase</span>
            <Link href="/help">Help</Link>
            <Link href="/support">Support</Link>
        </footer>
    )
}

/** The full-page 404: unknown addresses and visitors who aren't signed in. */
export function NotFoundPage({ signedIn: knownSignedIn }: { signedIn?: boolean }) {
    const stage = useRef<HTMLElement | null>(null)
    const heading = useHeadingFocus()
    const [path, setPath] = useState('')
    useEffect(() => {
        setPath(window.location.pathname)
        // A full page load: the page that linked here, if it was ours.
        try { const ref = document.referrer ? new URL(document.referrer) : null; reportBrokenLink(ref && ref.origin === window.location.origin ? ref.pathname : null) } catch { /* no referrer */ }
    }, [])
    const trail = useGridStage(stage)
    const context = useNotFoundContext(path, knownSignedIn)
    const signedIn = context?.signedIn ?? false
    const fix = (path ? suggestAddress(path, []) : null) ?? context?.place ?? null
    const recent = useRecentPages()
    const mainHref = signedIn ? '/discover' : '/'
    // The buttons are known now: let the grid snap the main one again, so its ring sits evenly.
    useEffect(() => { if (context) trail.current?.refresh() }, [context, trail])
    useEnterTo(context ? fix?.path ?? mainHref : null)
    const lead = !signedIn ? 'Check the address. If it’s private, sign in to see it.'
        : fix?.kind === 'section' ? 'The address may have a typo.'
            : fix?.kind === 'place' ? `There’s no ${fix.path.startsWith('/org/') ? 'organization' : 'workspace'} with that exact name.`
                : 'Check the address, or head back to where you were.'
    return (
        <main className="nb-err">
            <TopBar fallback={mainHref} />
            <section ref={stage} className="nb-err-stage" data-ready={context ? 'true' : 'false'} data-pixel-word="404" data-word-font="7" data-trail-script="cd ..|ls|cd ~/discover" aria-labelledby="nb-err-title">
                <p className="nb-err-path" title={path}><span aria-hidden="true">networkbase / </span><TypedAddress path={path} fix={fix} /><span className="nb-auth-caret" aria-hidden="true" />{path ? <span className="sr-only">The address {path} wasn’t found.</span> : null}</p>
                <div className="nb-err-slot" data-pixel-slot="" aria-hidden="true" />
                <h1 ref={heading} id="nb-err-title" tabIndex={-1} className="nb-err-title"><span className="sr-only">Error 404. </span>This page isn’t here.</h1>
                <p className="nb-err-lead nb-err-wait">{lead}</p>
                {fix ? <SuggestionBox fix={fix} /> : null}
                <div className="nb-err-actions nb-err-wait" data-cta-row="">
                    <Button asChild className="nb-err-primary" data-cta=""><Link href={mainHref}>{signedIn ? 'Go to Discover' : 'Go to the home page'}</Link></Button>
                    {signedIn ? null : <Link className="nb-link font-medium" href={buildAuthPageHref('/login', path || '/')}>Sign in</Link>}
                </div>
                <p className="nb-err-kbd nb-err-wait" aria-hidden="true"><kbd>Enter</kbd> {fix ? 'opens the suggestion' : signedIn ? 'goes to Discover' : 'goes to the home page'}</p>
                {signedIn ? <RecentlyVisited pages={recent} /> : null}
            </section>
            <Footer />
        </main>
    )
}

/** The full-page "Something went wrong" (a 500): a pixel 500 whose orange piece flies into the 5. */
export function ServerErrorPage({ reset, digest, homeHref = '/discover', homeLabel = 'Go to Discover' }: { reset: () => void; digest?: string; homeHref?: string; homeLabel?: string }) {
    const stage = useRef<HTMLElement | null>(null)
    const heading = useHeadingFocus()
    useGridStage(stage)
    return (
        <main className="nb-err">
            <TopBar fallback={homeHref} />
            <section ref={stage} className="nb-err-stage" data-pixel-word="500" data-word-font="7" data-trail-script="retry|nb status" aria-labelledby="nb-err-title">
                <div className="nb-err-slot" data-pixel-slot="" aria-hidden="true" />
                <h1 ref={heading} id="nb-err-title" tabIndex={-1} className="nb-err-title"><span className="sr-only">Error 500. </span>Something went wrong.</h1>
                <p className="nb-err-lead">It’s on our side, not yours. Try again, or come back in a minute.</p>
                <div className="nb-err-actions" data-cta-row="">
                    <Button type="button" className="nb-err-primary" data-cta="" onClick={reset}>Try again</Button>
                    <Link className="nb-link font-medium" href={homeHref}>{homeLabel}</Link>
                </div>
                {digest ? <p className="nb-err-ref">Reference {digest} · give this to support if it keeps happening</p> : null}
            </section>
            <Footer />
        </main>
    )
}

/** Inside the app the frame stays: a quiet card with the app's type, a pixel mark and the mono label (as on sign-in). */
function InlineCard({ mark, tone, label, title, children, waiting = false }: { mark: 'question' | 'alert'; tone?: 'danger'; label: string; title: ReactNode; children: ReactNode; waiting?: boolean }) {
    const heading = useHeadingFocus()
    return (
        <div className="nb-err-inline" data-ready={waiting ? 'false' : 'true'}>
            <span className="nb-err-inline-mark" data-tone={tone}><PixelIcon name={mark} size={24} /></span>
            <p className="nb-auth-eyebrow">{label}</p>
            <h1 ref={heading} tabIndex={-1} className="nb-card-title">{title}</h1>
            {children}
        </div>
    )
}

const SECTION_NAMES: Record<string, [string, string]> = {
    workspaces: ['Workspaces', 'This workspace isn’t here'],
    org: ['Organizations', 'This organization isn’t here'],
    u: ['Profiles', 'This profile isn’t here'],
    messages: ['Messages', 'This page isn’t here'],
    settings: ['Settings', 'This page isn’t here'],
}

/** A 404 inside the app (a missing workspace, profile or conversation): the app's bar and sidebar stay. */
export function InlineNotFound({ signedIn: knownSignedIn, section: fixedSection }: { signedIn?: boolean; section?: string }) {
    const [path, setPath] = useState('')
    useEffect(() => {
        setPath(window.location.pathname)
        // In the app the page that linked here is the history stamp's "from" (in-app-history), else a same-site referrer.
        void import('@/lib/navigation/in-app-history').then(({ currentEntry }) => {
            const entry = currentEntry()
            let from = entry?.from?.path ?? null
            if (!from) try { const ref = document.referrer ? new URL(document.referrer) : null; from = ref && ref.origin === window.location.origin ? ref.pathname : null } catch { /* none */ }
            reportBrokenLink(from)
        })
    }, [])
    const section = fixedSection ?? path.split('/')[1] ?? ''
    const [label, title] = SECTION_NAMES[section] ?? ['', 'This page isn’t here']
    const context = useNotFoundContext(path, knownSignedIn)
    const signedIn = context?.signedIn ?? false
    const fix = (path ? suggestAddress(path, []) : null) ?? context?.place ?? null
    const recent = useRecentPages()
    const home = section === 'messages' ? { href: '/messages', label: 'Back to Messages', variant: 'outline' as const }
        : section === 'workspaces' || section === 'org' ? { href: '/my-work', label: 'Go to your work', variant: 'default' as const }
            : { href: '/discover', label: 'Go to Discover', variant: 'default' as const }
    useEnterTo(context ? fix?.path ?? (signedIn ? home.href : '/') : null)
    return (
        <InlineCard mark="question" label={label ? `404 · ${label}` : '404'} title={<><span className="sr-only">Error 404. </span>{title}</>} waiting={!context}>
            <p className="nb-err-inline-text nb-err-wait">
                {!signedIn ? 'It may be private. Sign in to see it, or check the address.'
                    : section === 'messages' ? 'The link may be wrong, or what it pointed to was deleted.'
                        : 'It may have been deleted or renamed, or you may not have access.'}
            </p>
            {fix ? <SuggestionBox fix={fix} /> : null}
            <div className="nb-err-inline-actions nb-err-wait">
                {signedIn
                    ? <Button asChild variant={home.variant}><Link href={home.href}>{home.label}</Link></Button>
                    : <>
                        <Button asChild><Link href={buildAuthPageHref('/login', path || '/')}>Sign in</Link></Button>
                        <Button asChild variant="outline"><Link href="/">Go to the home page</Link></Button>
                    </>}
            </div>
            {signedIn ? <RecentlyVisited pages={recent} /> : null}
        </InlineCard>
    )
}

/** An error inside the app: only the part that broke says so, with Try again; the rest keeps working. */
export function InlineError({ reset, digest, offline = false, label = 'Error', title = 'This part didn’t load', back = { href: '/discover', label: 'Go to Discover' } }: {
    reset: () => void; digest?: string; offline?: boolean; label?: string; title?: string; back?: { href: string; label: string }
}) {
    return (
        <div role="alert" className="contents">
            <InlineCard mark="alert" tone="danger" label={label} title={offline ? 'You’re offline' : title}>
                <p className="nb-err-inline-text">{offline ? 'Pages you opened still work when you go back.' : 'It’s on our side. The rest of NetworkBase still works.'}</p>
                {digest ? <p className="nb-err-ref">Reference {digest}</p> : null}
                <div className="nb-err-inline-actions">
                    <Button type="button" onClick={reset}>Try again</Button>
                    <Button asChild variant="outline"><Link href={back.href}>{back.label}</Link></Button>
                </div>
            </InlineCard>
        </div>
    )
}
