'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

type TrustedBrowser = { id: string; label: string; lastSeenAt: string; trustedUntil: string; current: boolean }

const formatDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** Browsers that skip the two-step code ("Trust this browser for 30 days"), each one removable. */
export default function TrustedBrowsers() {
    const [browsers, setBrowsers] = useState<TrustedBrowser[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState<string | null>(null)

    const load = useCallback(async () => {
        const response = await fetch('/api/v1/auth/trusted-browser?list', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null)
        const body = await response?.json().catch(() => null) as { data?: { browsers?: TrustedBrowser[] } } | null
        if (!response?.ok || !body?.data?.browsers) {
            setError('Couldn’t load trusted browsers.')
            return
        }
        setError(null)
        setBrowsers(body.data.browsers)
    }, [])
    useEffect(() => { void load() }, [load])

    const stop = async (id?: string) => {
        setBusy(id ?? 'all')
        const response = await fetch('/api/v1/auth/trusted-browser', {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(id ? { id } : {}),
        }).catch(() => null)
        setBusy(null)
        if (!response?.ok) {
            setError('Couldn’t stop trusting that browser. Try again.')
            return
        }
        await load()
    }

    if (error) return <p className="text-sm text-[var(--status-danger)]">{error}</p>
    if (!browsers) return <div className="h-11 nb-skeleton rounded-[4px]" aria-busy="true" />
    if (browsers.length === 0) {
        return <p className="text-sm text-muted-foreground">No browser skips the code. Tick “Trust this browser for 30 days” when you enter your code to add one.</p>
    }
    return (
        <div className="space-y-3">
            <ul className="divide-y divide-border rounded-md border border-border">
                {browsers.map((browser) => (
                    <li key={browser.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{browser.label}{browser.current ? <span className="ml-2 text-xs font-normal text-muted-foreground">This browser</span> : null}</p>
                            <p className="text-xs text-muted-foreground">Skips the code until {formatDay(browser.trustedUntil)} · last used {formatDay(browser.lastSeenAt)}</p>
                        </div>
                        <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={busy !== null} onClick={() => void stop(browser.id)}>
                            {busy === browser.id ? 'Stopping…' : 'Stop trusting'}
                        </Button>
                    </li>
                ))}
            </ul>
            {browsers.length > 1 ? (
                <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => void stop()}>
                    {busy === 'all' ? 'Stopping…' : 'Stop trusting all browsers'}
                </Button>
            ) : null}
        </div>
    )
}
