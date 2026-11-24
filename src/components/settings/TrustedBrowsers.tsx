'use client'

import { useCallback, useEffect, useState } from 'react'
import { Laptop } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Tag } from '@/components/settings/mix/parts'
import { SecurityListRow } from '@/components/settings/ui/SecurityListRow'
import { SettingsSectionCard } from '@/components/settings/ui/SettingsSectionCard'
import { logDate } from '@/lib/settings/format'

type TrustedBrowser = { id: string; label: string; lastSeenAt: string; trustedUntil: string; current: boolean }

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

    const help = 'These browsers skip the two-step code for 30 days. Signing out other devices stops trusting all of them.'
    const body = error ? <p role="alert" className="nbs-ghelp text-[var(--status-danger)]">{error}</p>
        : !browsers ? <div className="nbs-li" aria-busy="true"><span className="tile" /><div className="h-8 nb-skeleton rounded-[4px]" /><span /></div>
        : browsers.length === 0 ? <p className="nbs-ghelp">No browser skips the code. Tick “Trust this browser for 30 days” when you enter your code to add one.</p>
        : <div className="nbs-list">
            {browsers.map((browser) => (
                <SecurityListRow key={browser.id} icon={Laptop} title={browser.current ? 'This browser' : browser.label}
                    badges={<Tag>Trusted</Tag>}
                    details={`${browser.current ? `${browser.label} · ` : ''}skips the code until ${logDate(browser.trustedUntil)} · used ${logDate(browser.lastSeenAt)}`}
                    action={<Button type="button" variant="ghost" size="sm" pending={busy === browser.id} disabled={busy !== null} onClick={() => void stop(browser.id)}>Stop trusting</Button>} />
            ))}
        </div>
    return (
        <SettingsSectionCard id="settings-security-trusted" title="Trusted browsers" description={help} flush
            right={browsers && browsers.length > 1 ? <Button type="button" variant="ghost" size="sm" pending={busy === 'all'} disabled={busy !== null} onClick={() => void stop()}>Stop trusting all</Button> : undefined}>
            {body}
        </SettingsSectionCard>
    )
}
