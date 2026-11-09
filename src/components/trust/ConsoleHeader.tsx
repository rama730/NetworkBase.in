'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/feedback'

import { inboxCountsAction } from '@/app/actions/moderation-staff'
import { LiveLine, useLiveEvents } from '@/components/trust/live'
import { NewCaseDialog } from '@/components/trust/NewCaseDialog'
import { Button } from '@/components/ui/button'
import type { InboxCounts } from '@/lib/trust/inbox'

const TABS = [
    { id: 'inbox', label: 'Inbox', count: (c: InboxCounts) => c.open + c.appeals + c.verification },
    { id: 'enforcement', label: 'Enforcement', count: (c: InboxCounts) => c.active },
    { id: 'insights', label: 'Insights' },
    { id: 'staff', label: 'Staff', admin: true },
] as const

/** Title, four tabs (R1), the live line (2.6), and new urgent cases announced to screen readers and as a toast (G17). */
export function ConsoleHeader({ counts: initial, isAdmin }: { counts: InboxCounts; isAdmin: boolean }) {
    const pathname = usePathname()
    const params = useSearchParams()
    const counts = useQuery({ queryKey: ['trust', 'counts'], queryFn: inboxCountsAction, initialData: initial, staleTime: 10_000 })
    const c = counts.data ?? initial
    const lastUrgent = useRef(c.urgent)
    const [announce, setAnnounce] = useState('')
    useLiveEvents(() => void counts.refetch())
    useEffect(() => {
        if (c.urgent > lastUrgent.current) {
            const text = c.urgent - lastUrgent.current === 1 ? 'New urgent case' : `${c.urgent - lastUrgent.current} new urgent cases`
            setAnnounce(text)
            toast(text, { action: { label: 'Open', onClick: () => window.history.replaceState(window.history.state, '', '/admin/trust?view=urgent') } })
        }
        lastUrgent.current = c.urgent
    }, [c.urgent])
    const tab = pathname.startsWith('/admin/trust/people') ? 'enforcement' : pathname !== '/admin/trust' ? 'inbox' : params.get('tab') ?? 'inbox'

    return (
        <header>
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[24px] font-semibold leading-tight text-foreground">Trust and safety</h1>
                <LiveLine />
                <div className="ml-auto"><NewCaseDialog trigger={<Button variant="outline" size="sm">New case</Button>} /></div>
            </div>
            <p aria-live="polite" className="sr-only">{announce}</p>
            <nav aria-label="Trust and safety" className="nb-tabs-list mt-2 flex min-h-10 items-center gap-5 overflow-x-auto border-b border-border">
                {TABS.filter((t) => !('admin' in t) || isAdmin).map((t) => {
                    const n = 'count' in t ? t.count(c) : 0
                    return (
                        <Link key={t.id} href={t.id === 'inbox' ? '/admin/trust' : `/admin/trust?tab=${t.id}`} aria-current={tab === t.id ? 'page' : undefined}
                            className={`nb-tab -mb-px inline-flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 text-[13px] font-medium ${tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                            {t.label}{n > 0 ? <span className="nb-tab-count">{n}</span> : null}
                        </Link>
                    )
                })}
            </nav>
        </header>
    )
}
