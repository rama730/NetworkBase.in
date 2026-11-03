'use client'

import type { RealtimeChannel } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { eventsSinceAction } from '@/app/actions/moderation-staff'
import { isPrivateRealtimeAuthorizationEnabled } from '@/lib/realtime/authorization'
import { openPrivateChannel } from '@/lib/realtime/private-broadcast'
import { createClient } from '@/lib/supabase/client'

// The console's live layer (Trust & Safety Console Redesign R6, S1–S5): one private staff-only channel,
// trust:console. Events carry only ids and the case version; the moderation log is the cursor, so a screen that
// missed anything asks for "everything after entry X". Presence on the same channel powers "Also viewing".

export type LiveEvent = { seq: number; caseId: string | null; kind: string; actorId: string | null; at: string }
export type Viewer = { staffId: string; name: string; caseId: string | null; mode: 'viewing' | 'deciding' }
export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'off'
type Listener = (events: LiveEvent[]) => void

/** Measured for the Health tab's live health (S14). */
export const liveStats = { catchUps: 0, lagMs: [] as number[], received: 0 }

type Live = {
    status: LiveStatus
    /** Server clock minus this computer's, measured when the console opens (S5). */
    offset: number
    viewers: Viewer[]
    me: string
    setMine: (caseId: string | null, mode: 'viewing' | 'deciding') => void
    subscribe: (listener: Listener) => () => void
}
const LiveContext = createContext<Live | null>(null)

const FLUSH_MS = 500
const FALLBACK_MS = 30_000
const HIDDEN_QUIET_MS = 120_000
// ponytail: concurrent commits can land out of seq order; catching up from 20 entries back with a seen-set
// covers that. A wider window if staff ever see a missed row.
const OVERLAP = 20

export function TrustLiveProvider({ staffId, name, children }: { staffId: string; name: string; children: ReactNode }) {
    const [status, setStatus] = useState<LiveStatus>('connecting')
    const [offset, setOffset] = useState(0)
    const [viewers, setViewers] = useState<Viewer[]>([])
    const listeners = useRef(new Set<Listener>())
    const mine = useRef<{ caseId: string | null; mode: 'viewing' | 'deciding' }>({ caseId: null, mode: 'viewing' })
    const channel = useRef<RealtimeChannel | null>(null)
    const statusRef = useRef<LiveStatus>('connecting')

    useEffect(() => {
        let stopped = false
        let seq: number | null = null
        const seen = new Set<number>()
        const buffer: LiveEvent[] = []
        let catching = false
        let again = false

        const take = (e: LiveEvent) => {
            if (seen.has(e.seq)) return
            seen.add(e.seq)
            if (seen.size > 2000) seen.delete(seen.values().next().value!)
            seq = Math.max(seq ?? 0, e.seq)
            buffer.push(e)
        }
        const catchUp = async () => {
            if (catching) { again = true; return }
            catching = true
            try {
                do {
                    again = false
                    let more = true
                    while (more && !stopped) {
                        const r = await eventsSinceAction(seq == null ? null : Math.max(0, seq - OVERLAP))
                        if (!r) return
                        setOffset(r.now - Date.now())
                        if (seq == null) { seq = r.seq; break }
                        const fresh = r.events.filter((e) => !seen.has(e.seq))
                        for (const e of r.events) take({ seq: e.seq, caseId: e.case_id, kind: e.kind, actorId: e.actor_id, at: e.at })
                        if (fresh.length) liveStats.catchUps += 1
                        more = r.more
                    }
                } while (again && !stopped)
            } catch {
                // The next fallback tick tries again.
            } finally {
                catching = false
            }
        }
        const set = (next: LiveStatus) => { statusRef.current = next; setStatus(next) }

        const flush = window.setInterval(() => {
            if (!buffer.length) return
            const batch = buffer.splice(0)
            listeners.current.forEach((listener) => listener(batch))
        }, FLUSH_MS)
        const fallback = window.setInterval(() => {
            if (statusRef.current !== 'live' && document.visibilityState === 'visible') void catchUp()
        }, FALLBACK_MS)
        // Presence goes quiet 2 minutes after the tab is hidden, not at once, so a quick tab switch doesn't flicker (2.4).
        let quiet: number | null = null
        let silent = false
        const onVisible = () => {
            if (quiet) { window.clearTimeout(quiet); quiet = null }
            if (document.visibilityState === 'visible') { silent = false; void catchUp(); track() }
            else quiet = window.setTimeout(() => { silent = true; if (channel.current) void channel.current.untrack() }, HIDDEN_QUIET_MS)
        }
        document.addEventListener('visibilitychange', onVisible)

        const track = () => {
            if (statusRef.current !== 'live' || !channel.current || silent) return
            void channel.current.track({ staffId, name, caseId: mine.current.caseId, mode: mine.current.mode })
        }
        trackRef.current = track

        void catchUp()
        if (!isPrivateRealtimeAuthorizationEnabled()) {
            set('off')
        } else {
            void (async () => {
                const ch = await openPrivateChannel('trust:console', { presence: { key: staffId }, broadcast: { self: true } })
                if (stopped) { if (ch) void createClient().removeChannel(ch); return }
                if (!ch) return set('reconnecting')
                channel.current = ch
                ch.on('broadcast', { event: 'event' }, (message: { payload?: Record<string, unknown> }) => {
                    const p = message.payload ?? {}
                    const e: LiveEvent = { seq: Number(p.seq), caseId: (p.caseId as string | null) ?? null, kind: String(p.kind ?? ''), actorId: (p.actorId as string | null) ?? null, at: String(p.at ?? '') }
                    if (!Number.isFinite(e.seq)) return
                    liveStats.received += 1
                    const lag = Date.now() + offsetRef.current - new Date(e.at).getTime()
                    if (Number.isFinite(lag)) liveStats.lagMs = [...liveStats.lagMs.slice(-49), Math.max(0, lag)]
                    // A gap means something was missed: ask the log rather than guess.
                    if (seq != null && e.seq > seq + 1) void catchUp()
                    take(e)
                })
                ch.on('presence', { event: 'sync' }, () => {
                    const state = ch.presenceState() as Record<string, Viewer[]>
                    // One person with two tabs shows once: the tab that's deciding wins.
                    const byStaff = new Map<string, Viewer>()
                    for (const metas of Object.values(state)) for (const v of metas) {
                        const prev = byStaff.get(v.staffId)
                        if (!prev || v.mode === 'deciding') byStaff.set(v.staffId, { staffId: v.staffId, name: v.name, caseId: v.caseId, mode: v.mode })
                    }
                    setViewers([...byStaff.values()])
                })
                ch.subscribe((s: string) => {
                    if (stopped) return
                    if (s === 'SUBSCRIBED') { set('live'); track(); void catchUp() } else set('reconnecting')
                })
            })().catch(() => set('reconnecting'))
        }
        return () => {
            stopped = true
            window.clearInterval(flush)
            window.clearInterval(fallback)
            if (quiet) window.clearTimeout(quiet)
            document.removeEventListener('visibilitychange', onVisible)
            if (channel.current) void createClient().removeChannel(channel.current)
            channel.current = null
        }
    }, [staffId, name])

    const offsetRef = useRef(0)
    offsetRef.current = offset
    const trackRef = useRef<() => void>(() => undefined)

    const setMine = useCallback((caseId: string | null, mode: 'viewing' | 'deciding') => {
        if (mine.current.caseId === caseId && mine.current.mode === mode) return
        mine.current = { caseId, mode }
        trackRef.current()
    }, [])
    const subscribe = useCallback((listener: Listener) => { listeners.current.add(listener); return () => { listeners.current.delete(listener) } }, [])
    const value = useMemo<Live>(() => ({ status, offset, viewers, me: staffId, setMine, subscribe }), [status, offset, viewers, staffId, setMine, subscribe])
    return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>
}

export function useLive() {
    const live = useContext(LiveContext)
    if (!live) throw new Error('useLive needs TrustLiveProvider')
    return live
}

/** Runs on each half-second batch of events. */
export function useLiveEvents(listener: Listener) {
    const { subscribe } = useLive()
    const ref = useRef(listener)
    ref.current = listener
    useEffect(() => subscribe((events) => ref.current(events)), [subscribe])
}

/** Server time for countdowns (S5), ticking every 30 seconds. */
export function useServerNow() {
    const { offset } = useLive()
    const [now, setNow] = useState(() => Date.now() + offset)
    useEffect(() => {
        setNow(Date.now() + offset)
        const t = window.setInterval(() => setNow(Date.now() + offset), 30_000)
        return () => window.clearInterval(t)
    }, [offset])
    return now
}

/** "Live updates paused · reconnecting" (2.6). */
export function LiveLine() {
    const { status } = useLive()
    if (status === 'live' || status === 'connecting') return null
    return (
        <p role="status" className="text-[12px] text-[var(--status-warning)]">
            {status === 'off' ? 'Live updates off · checking every 30 seconds' : 'Live updates paused · reconnecting'}
        </p>
    )
}
