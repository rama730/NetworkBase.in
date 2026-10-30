'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
    subscribeUserNotifications,
    type UserNotificationEvent,
} from '@/lib/realtime/subscriptions';

export type RealtimeConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';
export type RealtimeHealthState = 'healthy' | 'reconnecting' | 'offline' | 'unavailable';

interface RealtimeContextType {
    isConnected: boolean;
    notificationStatus: RealtimeConnectionStatus;
    connectionHealth: RealtimeHealthState;
    retryRealtime: () => void;
    subscribeUserNotifications: (listener: (event: UserNotificationEvent) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextType>({
    isConnected: false,
    notificationStatus: 'idle',
    connectionHealth: 'healthy',
    retryRealtime: () => { },
    subscribeUserNotifications: () => () => { },
});

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
    const { user, session, isLoading, refreshProfile } = useAuthContext();
    const isOnline = useOnlineStatus();
    const [notificationStatus, setNotificationStatus] = useState<RealtimeConnectionStatus>('idle');
    const [reconnectNonce, setReconnectNonce] = useState(0);
    const [connectionHealth, setConnectionHealth] = useState<RealtimeHealthState>('healthy');
    const listenersRef = useRef(new Set<(event: UserNotificationEvent) => void>());
    const connectionTokenRef = useRef(0);
    const healthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wasOnlineRef = useRef(isOnline);

    const refreshProfileRef = useRef(refreshProfile);

    useEffect(() => {
        refreshProfileRef.current = refreshProfile;
    }, [refreshProfile]);

    const handleUserNotification = useCallback((event: UserNotificationEvent) => {
        // The database only announces a change to the name, handle or picture.
        if (event.kind === 'profile') void refreshProfileRef.current();

        for (const listener of listenersRef.current) {
            try {
                listener(event);
            } catch (error) {
                console.error('Error in user notification listener', {
                    error,
                    event,
                    listener: listener.name || 'anonymous',
                });
            }
        }
    }, []);

    const registerUserNotificationListener = useCallback((listener: (event: UserNotificationEvent) => void) => {
        listenersRef.current.add(listener);
        return () => {
            listenersRef.current.delete(listener);
        };
    }, []);

    const retryRealtime = useCallback(() => {
        if (!navigator.onLine) return;
        setReconnectNonce((current) => current + 1);
    }, []);

    // The browser "online" event is the one reliable signal that a fresh
    // transport attempt is useful. It avoids background health polling while
    // still recovering promptly after an actual network interruption.
    useEffect(() => {
        if (isOnline && !wasOnlineRef.current && user) {
            setReconnectNonce((current) => current + 1);
        }
        wasOnlineRef.current = isOnline;
    }, [isOnline, user?.id]);

    // A connection warning should describe transport health, not a business
    // notification count. Brief channel churn is normal, so wait before
    // surfacing it and clear the warning as soon as the channel recovers.
    // Chat runs on its own private topics (ChatShellProvider).
    useEffect(() => {
        if (healthTimerRef.current) {
            clearTimeout(healthTimerRef.current);
            healthTimerRef.current = null;
        }

        if (!user || isLoading || !session?.access_token) {
            setConnectionHealth('healthy');
            return;
        }

        if (!isOnline) {
            setConnectionHealth('offline');
            return;
        }

        if (notificationStatus === 'connected') {
            setConnectionHealth('healthy');
            return;
        }

        const nextState: RealtimeHealthState = notificationStatus === 'disconnected' ? 'unavailable' : 'reconnecting';

        healthTimerRef.current = setTimeout(() => {
            setConnectionHealth(nextState);
            healthTimerRef.current = null;
        }, 3_000);

        return () => {
            if (healthTimerRef.current) {
                clearTimeout(healthTimerRef.current);
                healthTimerRef.current = null;
            }
        };
    }, [isLoading, isOnline, notificationStatus, session?.access_token, user?.id]);

    useEffect(() => {
        if (!user) {
            connectionTokenRef.current += 1;
            setNotificationStatus('idle');
            return;
        }
        if (!session?.access_token || isLoading) {
            connectionTokenRef.current += 1;
            setNotificationStatus('connecting');
            return;
        }

        const connectionToken = connectionTokenRef.current + 1;
        connectionTokenRef.current = connectionToken;
        setNotificationStatus('connecting');
        const subscription = subscribeUserNotifications({
            userId: user.id,
            onEvent: handleUserNotification,
            onStatus: (status) => {
                if (connectionTokenRef.current !== connectionToken) return;
                if (status === 'connected') setNotificationStatus('connected');
                else if (status !== 'connecting') setNotificationStatus('disconnected');
            },
        });

        return () => {
            connectionTokenRef.current += 1;
            subscription.unsubscribe();
        };
    }, [handleUserNotification, isLoading, reconnectNonce, session?.access_token, user?.id]);

    const isConnected = notificationStatus === 'connected';
    const value = useMemo(
        () => ({
            isConnected,
            notificationStatus,
            connectionHealth,
            retryRealtime,
            subscribeUserNotifications: registerUserNotificationListener,
        }),
        [
            isConnected,
            notificationStatus,
            connectionHealth,
            registerUserNotificationListener,
            retryRealtime,
        ],
    );

    return (
        <RealtimeContext.Provider value={value}>
            {children}
        </RealtimeContext.Provider>
    );
}

export function useRealtime() {
    return useContext(RealtimeContext);
}
