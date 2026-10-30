'use client'

import { useRouter } from 'next/navigation'
import { useRef } from 'react'

import { useLiveEvents } from '@/components/trust/live'

/** Server-rendered tabs (Enforcement, Health) follow the live log too, but never while someone is typing. */
export function RefreshOnEvents() {
    const router = useRouter()
    const timer = useRef<number | null>(null)
    useLiveEvents(() => {
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
            const active = document.activeElement
            if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)) router.refresh()
        }, 2_000)
    })
    return null
}
