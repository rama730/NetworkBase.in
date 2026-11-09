'use client'

import { useEffect, useRef } from 'react'
import { useAuth as useAuthContext } from '@/hooks/use-auth'
import { userTopic } from '@/lib/messaging/constants'
import { subscribeBroadcast } from '@/lib/realtime/private-broadcast'

/**
 * Live roster and queue (report §32.4, decision 76): a new submission reaches admins as a notice, so a notice on their
 * own topic reloads the list, combined over 2 seconds.
 */
export function useReloadOnNotice(reload: () => void) {
    const viewerId = useAuthContext().user?.id
    const latest = useRef(reload)
    latest.current = reload
    useEffect(() => {
        if (!viewerId) return
        let timer: ReturnType<typeof setTimeout> | null = null
        // Audit 5.1, 5.6: join requests arrive on the same personal topic; 2–5 s with jitter (5.2) so open pages don't
        // all reload at once.
        const live = subscribeBroadcast(userTopic(viewerId), (event) => {
            if ((event === 'notification.changed' || event === 'org.requests.changed') && !timer) timer = setTimeout(() => { timer = null; latest.current() }, 2_000 + Math.random() * 3_000)
        })
        return () => { live.unsubscribe(); if (timer) clearTimeout(timer) }
    }, [viewerId])
}
