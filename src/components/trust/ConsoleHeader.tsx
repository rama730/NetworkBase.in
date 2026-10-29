'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/feedback'

import { NewCaseDialog } from '@/components/trust/NewCaseDialog'
import { Button } from '@/components/ui/button'

type Counts = { open: number; urgent: number; overdue: number; appeals: number; active: number; verification: number }

const TABS = [
    { id: 'queue', label: 'Queue', count: (c: Counts) => c.open },
    { id: 'appeals', label: 'Appeals', count: (c: Counts) => c.appeals },
    { id: 'active', label: 'Active', count: (c: Counts) => c.active },
    { id: 'people', label: 'People' },
    { id: 'verification', label: 'Verification', count: (c: Counts) => c.verification },
    { id: 'health', label: 'Health' },
    { id: 'audit', label: 'Audit log' },
] as const

/** Title, the counts line, the tab bar (17.2). Refreshes every minute; a new urgent case raises a toast. */
export function ConsoleHeader({ counts }: { counts: Counts }) {
    const router = useRouter()
    const pathname = usePathname()
    const params = useSearchParams()
    const [updatedAt, setUpdatedAt] = useState(() => Date.now())
    const [, tick] = useState(0)
    const lastUrgent = useRef(counts.urgent)
    const tab = pathname.startsWith('/admin/trust/people') ? 'people' : pathname.startsWith('/admin/trust/cases') ? 'queue' : pathname.startsWith('/admin/trust/appeals') ? 'appeals' : params.get('tab') ?? 'queue'

    useEffect(() => {
        const timer = window.setInterval(() => {
            // Keep an open form: only refresh while nobody is typing.
            const active = document.activeElement
            if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)) router.refresh()
            tick((n) => n + 1)
        }, 60_000)
        return () => window.clearInterval(timer)
    }, [router])
    useEffect(() => {
        setUpdatedAt(Date.now())
        if (counts.urgent > lastUrgent.current) toast('New urgent case', { action: { label: 'Open', onClick: () => router.push('/admin/trust?severity=urgent') } })
        lastUrgent.current = counts.urgent
    }, [counts, router])

    const minutes = Math.floor((Date.now() - updatedAt) / 60_000)
    return (
        <header className="mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="nb-page-title text-foreground">Trust &amp; safety</h1>
                <NewCaseDialog trigger={<Button variant="outline">New case</Button>} />
            </div>
            <p className="nb-meta mt-1">
                {counts.open} open · {counts.urgent} urgent · {counts.overdue} overdue · {counts.appeals} appeals · Updated {minutes < 1 ? 'just now' : `${minutes} min ago`}
            </p>
            <nav aria-label="Trust and safety" className="nb-tabs-list mt-4 flex min-h-10 items-center gap-5 border-b border-border">
                {TABS.map((t) => (
                    <Link key={t.id} href={t.id === 'queue' ? '/admin/trust' : `/admin/trust?tab=${t.id}`} aria-current={tab === t.id ? 'page' : undefined}
                        className={`nb-tab -mb-px inline-flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 text-[13px] font-medium ${tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                        {t.label}{'count' in t && t.count(counts) > 0 ? <span className="nb-tab-count">{t.count(counts)}</span> : null}
                    </Link>
                ))}
            </nav>
        </header>
    )
}
