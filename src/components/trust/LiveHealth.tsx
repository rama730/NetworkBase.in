'use client'

import { useEffect, useState } from 'react'

import { liveStats, useLive } from '@/components/trust/live'

/** Live health (S14): staff connected now, how long events take to arrive, catch-ups, refused stale actions. */
export function LiveHealth({ staleRefused, days }: { staleRefused: number; days: number }) {
    const { status, viewers } = useLive()
    const [, tick] = useState(0)
    useEffect(() => {
        const t = window.setInterval(() => tick((n) => n + 1), 5_000)
        return () => window.clearInterval(t)
    }, [])
    const lags = [...liveStats.lagMs].sort((a, b) => a - b)
    const median = lags.length ? lags[Math.floor(lags.length / 2)]! : null
    const rows: Array<[string, string]> = [
        ['This screen', status === 'live' ? 'Live' : status === 'off' ? 'Checking every 30 seconds' : status === 'connecting' ? 'Connecting' : 'Reconnecting'],
        ['Staff connected now', status === 'live' ? String(viewers.length) : '—'],
        ['Event arrival (median of the last 50)', median === null ? '—' : median < 1000 ? `${Math.round(median)} ms` : `${(median / 1000).toFixed(1)} s`],
        ['Catch-ups on this screen', String(liveStats.catchUps)],
        [`Refused stale actions (${days} days)`, String(staleRefused)],
    ]
    return (
        <table className="w-full">
            <tbody>{rows.map(([k, v]) => <tr key={k}><td className="py-1.5 text-[13px]">{k}</td><td className="py-1.5 text-right font-mono text-[13px] tabular-nums">{v}</td></tr>)}</tbody>
        </table>
    )
}
