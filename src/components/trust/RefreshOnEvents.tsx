'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { useLiveEvents } from '@/components/trust/live'

/** Server-rendered tabs (Enforcement, Health) follow the live log too, but never while someone is typing. */
export function RefreshOnEvents() {
    const router = useRouter()
    const timer = useRef<number | null>(null)
    const missed = useRef(false)
    useEffect(() => {
        const onVisible = () => { if (!document.hidden && missed.current) { missed.current = false; router.refresh() } }
        document.addEventListener('visibilitychange', onVisible)
        return () => document.removeEventListener('visibilitychange', onVisible)
    }, [router])
    useLiveEvents(() => {
        // A hidden console re-renders once on return, not per event.
        if (document.hidden) { missed.current = true; return }
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
            const active = document.activeElement
            if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)) router.refresh()
        }, 2_000)
    })
    return null
}
