'use client';

import { useEffect, useState } from 'react';
import { liveStore } from '@/components/presence/live-online';
import { useAuth } from '@/hooks/useAuth';
import { usePublishOnlinePresence } from '@/hooks/usePublishOnlinePresence';
import { PRESENCE_VISIBILITY_EVENT } from '@/lib/presence/events';

interface PresenceProviderProps {
    children?: React.ReactNode;
    presenceEnabled?: boolean;
}

const IDLE_MS = 5 * 60_000;
// One heartbeat a minute while engaged keeps "Active now" fresh everywhere (the
// server's live key lives 150 s); the database write stays at once per 5 minutes.
const HEARTBEAT_INTERVAL_MS = 60_000;
const INITIAL_HEARTBEAT_COOLDOWN_MS = 60_000;
let lastSuccessfulHeartbeatAt = 0;
let heartbeatInFlight = false;

function OnlinePresencePublisher() {
    usePublishOnlinePresence();
    return null;
}

/** App-wide presence: a coarse heartbeat for last-active plus the user's own presence room while engaged. */
export function PresenceProvider({ children = null, presenceEnabled = true }: PresenceProviderProps) {
    const { user, session, isLoading } = useAuth();
    const active = Boolean(user) && !isLoading;
    const presenceActive = active && presenceEnabled;
    // Realtime needs the access token, like every other realtime hook.
    const realtimeReady = Boolean(user && session?.access_token && !isLoading) && presenceEnabled;
    const [engaged, setEngaged] = useState(() => typeof document === 'undefined' || !document.hidden);
    // Hidden activity (server says so): no realtime "online" either.
    const [hidden, setHidden] = useState(false);

    useEffect(() => {
        if (!presenceActive) {
            setEngaged(false);
            return;
        }

        let idleTimer: number | null = null;
        const pause = () => {
            if (idleTimer !== null) window.clearTimeout(idleTimer);
            idleTimer = null;
            setEngaged(false);
        };
        const resume = () => {
            if (document.hidden) return;
            setEngaged(true);
            if (idleTimer !== null) window.clearTimeout(idleTimer);
            idleTimer = window.setTimeout(pause, IDLE_MS);
        };
        const onVisibilityChange = () => document.hidden ? pause() : resume();
        const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'focus'] as const;

        activityEvents.forEach((name) => window.addEventListener(name, resume, { passive: true }));
        document.addEventListener('visibilitychange', onVisibilityChange);
        onVisibilityChange();
        return () => {
            if (idleTimer !== null) window.clearTimeout(idleTimer);
            activityEvents.forEach((name) => window.removeEventListener(name, resume));
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [presenceActive]);

    // Changing "Show when I'm active" takes effect at once, without waiting for a heartbeat.
    // The one shared "who is online" store: open only while signed in with a token and not hiding your own activity.
    useEffect(() => {
        liveStore.setReady(realtimeReady && !hidden);
    }, [realtimeReady, hidden]);
    useEffect(() => {
        liveStore.setSelf(user?.id ?? null);
    }, [user?.id]);

    useEffect(() => {
        const onVisibility = (event: Event) => setHidden((event as CustomEvent<{ hidden?: boolean }>).detail?.hidden === true);
        window.addEventListener(PRESENCE_VISIBILITY_EVENT, onVisibility);
        return () => window.removeEventListener(PRESENCE_VISIBILITY_EVENT, onVisibility);
    }, []);

    useEffect(() => {
        if (!presenceActive || !engaged) return;

        const heartbeat = async (initial = false) => {
            if (heartbeatInFlight) return;
            if (initial && Date.now() - lastSuccessfulHeartbeatAt < INITIAL_HEARTBEAT_COOLDOWN_MS) return;
            heartbeatInFlight = true;
            try {
                const response = await fetch('/api/v1/presence/heartbeat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    // The time zone powers "local time" on someone's details (chat).
                    body: JSON.stringify({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
                    keepalive: true,
                });
                if (response.ok) {
                    lastSuccessfulHeartbeatAt = Date.now();
                    const body = await response.json().catch(() => null) as { data?: { hidden?: boolean } } | null;
                    setHidden(body?.data?.hidden === true);
                }
            } finally {
                heartbeatInFlight = false;
            }
        };

        void heartbeat(true);
        const interval = window.setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
        return () => window.clearInterval(interval);
    }, [engaged, presenceActive, user?.id]);

    // Closing the tab clears "Active now" at once instead of waiting out the live key's TTL.
    // Another open tab sets it again on its next heartbeat; chat's realtime presence sees it sooner.
    useEffect(() => {
        if (!presenceActive) return;
        const goOffline = (event: PageTransitionEvent) => {
            if (event.persisted) return; // bfcache: page may come back
            void fetch('/api/v1/presence/heartbeat', { method: 'DELETE', keepalive: true }).catch(() => undefined);
        };
        window.addEventListener('pagehide', goOffline);
        return () => window.removeEventListener('pagehide', goOffline);
    }, [presenceActive]);

    return (
        <>
            {children}
            {presenceActive && engaged && !hidden ? <OnlinePresencePublisher /> : null}
        </>
    );
}
