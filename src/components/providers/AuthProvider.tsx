'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import type { Profile } from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import {
    type AuthResult,
    type OAuthResult,
    type SignUpOptions,
    forgetSyncedBrowserSession,
    signInWithGoogleIdToken as signInWithGoogleIdTokenAction,
    signInWithPassword,
    signUpWithPassword,
    startOAuthSignIn,
    bootstrapBrowserSessionFromServer,
    syncBrowserSessionToServer,
    verifyEmailOtp,
} from '@/lib/auth/browser-auth-actions';
import { resetMonotonicEntity, runMonotonicUpdate } from '@/lib/state/monotonic';
import { loadBrowserProfile, normalizeProfileRecord, profileNeedsHydration } from '@/lib/profile/browser-profile';
import { cacheManager } from '@/lib/utils/cache-manager';
import { unsubscribeWebPush } from '@/lib/notifications/web-push-client';

// --- Types ---
interface AuthState {
    user: User | null;
    session: Session | null;
    profile: Profile | null;
    isLoading: boolean;
}

interface AuthContextType extends AuthState {
    isAuthenticated: boolean;
    signIn: (email: string, password: string, captchaToken?: string) => Promise<AuthResult>;
    signUp: (
        email: string,
        password: string,
        fullName?: string,
        captchaToken?: string,
        legalAccepted?: boolean,
        options?: SignUpOptions
    ) => Promise<AuthResult>;
    verifyOtp: (email: string, token: string, type?: 'signup' | 'email') => Promise<AuthResult>;
    signOut: () => Promise<void>;
    signInWithGoogle: (nextPath?: string | null) => Promise<OAuthResult>;
    signInWithGoogleIdToken: (token: string, nonce: string) => Promise<AuthResult>;
    signInWithGitHub: (nextPath?: string | null) => Promise<OAuthResult>;
    refreshProfile: () => Promise<void>;
}

const signIn = signInWithPassword;
const signUp = signUpWithPassword;
const verifyOtp = verifyEmailOtp;
const signInWithGoogleIdToken = signInWithGoogleIdTokenAction;
const signInWithGoogle = (nextPath?: string | null) => startOAuthSignIn('google', nextPath);
const signInWithGitHub = (nextPath?: string | null) => startOAuthSignIn('github', nextPath);

// --- Context ---
const AuthContext = createContext<AuthContextType | undefined>(undefined);


// --- Provider ---
export function AuthProvider({
    children,
    initialUser,
    initialProfile
}: {
    children: React.ReactNode;
    initialUser: User | null;
    initialProfile: any | null;
}) {
    const MONOTONIC_AUTH_KEY = 'auth-provider:state';
    const transformedInitialProfile = useMemo(
        () => (initialProfile ? normalizeProfileRecord(initialProfile) : null),
        [initialProfile],
    );
    const [state, setState] = useState<AuthState>({
        user: initialUser,
        session: null, // session will be populated by client-side listener
        profile: transformedInitialProfile,
        isLoading: !initialUser, // Stay unresolved until the client auth snapshot confirms signed-in or signed-out
    });
    const activeUserIdRef = useRef<string | null>(initialUser?.id || null);
    const authEventVersionRef = useRef(0);
    const bootstrapHydrationPendingRef = useRef(Boolean(initialUser) && (!initialProfile || profileNeedsHydration(initialProfile)));
    const bootstrapSessionAttemptedRef = useRef(false);
    const browserSessionBootstrapPendingRef = useRef(true);
    const router = useRouter();

    // Sync with Supabase Auth Listener
    useEffect(() => {
        const supabase = createClient();
        let cancelled = false;

        const loadProfile = loadBrowserProfile;
        
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event: string, session: Session | null) => {
                const eventVersion = ++authEventVersionRef.current;
                if (cancelled) return;
                if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) {
                    browserSessionBootstrapPendingRef.current = false;
                    void syncBrowserSessionToServer(session).catch((error) => {
                        logger.warn('auth.session.sync_failed', {
                            event,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    });
                    if (session.user.id !== activeUserIdRef.current) {
                        const profile = await loadProfile(session.user.id);
                        if (cancelled || eventVersion !== authEventVersionRef.current) return;
                        const applied = runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                            activeUserIdRef.current = session.user.id;
                            setState({
                                user: session.user,
                                session,
                                profile,
                                isLoading: false
                            });
                        });
                        if (applied === null) return;
                        if (event === 'SIGNED_IN') {
                            router.refresh();
                        }
                        return;
                    }

                    browserSessionBootstrapPendingRef.current = false;
                    runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                        setState(prev => ({
                            ...prev,
                            user: session.user,
                            session,
                            isLoading: false
                        }));
                    });
                } else if (event === 'INITIAL_SESSION' && !session) {
                    if (initialUser || browserSessionBootstrapPendingRef.current) {
                        return;
                    }
                    runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                        activeUserIdRef.current = null;
                        setState({
                            user: null,
                            session: null,
                            profile: null,
                            isLoading: false,
                        });
                    });
                } else if (event === 'SIGNED_OUT') {
                    browserSessionBootstrapPendingRef.current = false;
                    syncBrowserSessionToServer(null).catch((error) => {
                        logger.warn('auth.session.clear_failed', {
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }).finally(async () => {
                        if (typeof window !== 'undefined') {
                            await cacheManager.clearAll().catch(() => null);
                        }
                        runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                            activeUserIdRef.current = null;
                            setState({
                                user: null,
                                session: null,
                                profile: null,
                                isLoading: false
                            });
                        });
                        if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
                            window.location.href = '/login';
                        }
                    });
                } else if (event === 'USER_UPDATED' && session) {
                    browserSessionBootstrapPendingRef.current = false;
                    void syncBrowserSessionToServer(session).catch((error) => {
                        logger.warn('auth.session.sync_failed', {
                            event,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    });
                    const profile = await loadProfile(session.user.id);
                    if (cancelled || eventVersion !== authEventVersionRef.current) return;
                    runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                        activeUserIdRef.current = session.user.id;

                        setState(prev => ({
                            ...prev,
                            user: session.user,
                            session,
                            profile: profile || prev.profile,
                            isLoading: false
                        }));
                    });
                } else if (event === 'TOKEN_REFRESHED' && session) {
                    browserSessionBootstrapPendingRef.current = false;
                    void syncBrowserSessionToServer(session).catch((error) => {
                        logger.warn('auth.session.sync_failed', {
                            event,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    });
                    runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                        activeUserIdRef.current = session.user.id;
                        setState(prev => ({ ...prev, session, user: session.user }));
                    });
                }
            }
        );

        void (async () => {
            if (bootstrapSessionAttemptedRef.current) return;
            bootstrapSessionAttemptedRef.current = true;

            try {
                const { data: existingSession } = await supabase.auth.getSession();
                if (cancelled) return;

                if (existingSession.session) {
                    const eventVersion = ++authEventVersionRef.current;
                    browserSessionBootstrapPendingRef.current = false;
                    if (existingSession.session.user.id !== activeUserIdRef.current) {
                        const profile = await loadProfile(existingSession.session.user.id);
                        if (cancelled || eventVersion !== authEventVersionRef.current) return;
                        runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                            activeUserIdRef.current = existingSession.session!.user.id;
                            setState({
                                user: existingSession.session!.user,
                                session: existingSession.session,
                                profile,
                                isLoading: false,
                            });
                        });
                        return;
                    }

                    runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                        setState((prev) => ({
                            ...prev,
                            user: existingSession.session!.user,
                            session: existingSession.session,
                            profile: prev.profile ?? transformedInitialProfile,
                            isLoading: false,
                        }));
                    });
                    return;
                }

                if (initialUser) {
                    const serverSession = await bootstrapBrowserSessionFromServer();
                    if (cancelled) return;
                    if (!serverSession) {
                        browserSessionBootstrapPendingRef.current = false;
                        return;
                    }
                    await supabase.auth.setSession(serverSession);
                    browserSessionBootstrapPendingRef.current = false;
                    return;
                }

                const eventVersion = ++authEventVersionRef.current;
                browserSessionBootstrapPendingRef.current = false;
                runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                    activeUserIdRef.current = null;
                    setState({
                        user: null,
                        session: null,
                        profile: null,
                        isLoading: false,
                    });
                });
            } catch (error) {
                logger.warn('auth.session.bootstrap_failed', {
                    error: error instanceof Error ? error.message : String(error),
                });
                browserSessionBootstrapPendingRef.current = false;
                if (cancelled || initialUser) return;
                const eventVersion = ++authEventVersionRef.current;
                runMonotonicUpdate(MONOTONIC_AUTH_KEY, eventVersion, () => {
                    activeUserIdRef.current = null;
                    setState({
                        user: null,
                        session: null,
                        profile: null,
                        isLoading: false,
                    });
                });
            }
        })();

        return () => {
            cancelled = true;
            subscription.unsubscribe();
            resetMonotonicEntity(MONOTONIC_AUTH_KEY);
        };
    }, [initialUser, router, transformedInitialProfile]);

    // --- Actions ---
    const signOut = useCallback(async () => {
        const supabase = createClient();

        // The authenticated delete must run before Auth cookies/session disappear.
        const pushCleanup = await unsubscribeWebPush().catch(() => ({ ok: false as const, reason: 'cleanup_failed' }));
        if (!pushCleanup.ok && pushCleanup.reason !== 'unsupported') {
            logger.warn('auth.signout_push_cleanup_failed', {
                module: 'auth',
                reason: pushCleanup.reason,
            });
        }

        // 1. Await the idempotent server cookie deletion first.
        await syncBrowserSessionToServer(null).catch((error) => {
            logger.warn('auth.session.clear_failed', {
                error: error instanceof Error ? error.message : String(error),
            });
        });
        
        // 2. Clear browser session (this also fires the SIGNED_OUT listener)
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
        if (signOutError) {
            logger.warn('auth.signout_local_failed', {
                error: signOutError.message,
            });
        }
        forgetSyncedBrowserSession();
        
        // 3. Clear all cached browser storages (IndexedDB, LocalStorage, Cache API)
        if (typeof window !== 'undefined') {
            await cacheManager.clearAll().catch(() => null);
            
            // 4. Dispatch cache-clearing event
            window.dispatchEvent(new Event('auth:signout'));
            
            // 5. Hard redirect if not already handled
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        }
    }, []);

    const refreshProfile = useCallback(async () => {
        const currentUser = state.user; // Use current state user
        if (!currentUser) return;

        const profile = await loadBrowserProfile(currentUser.id);
        if (profile) {
            setState(prev => ({ ...prev, profile: prev.profile ? { ...prev.profile, ...profile } : profile }));
        }
    }, [state.user]);

    useEffect(() => {
        if (!bootstrapHydrationPendingRef.current || !state.user) return;

        let cancelled = false;
        const hydrate = () => {
            if (cancelled) return;
            bootstrapHydrationPendingRef.current = false;
            void refreshProfile();
        };

        const requestIdle = (window as Window & {
            requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        }).requestIdleCallback;
        if (typeof requestIdle === 'function') {
            const handle = requestIdle(hydrate, { timeout: 1_500 });
            return () => {
                cancelled = true;
                const cancelIdle = (window as Window & {
                    cancelIdleCallback?: (handle: number) => void;
                }).cancelIdleCallback;
                if (typeof cancelIdle === 'function') {
                    cancelIdle(handle);
                }
            };
        }

        const timer = window.setTimeout(hydrate, 250);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [refreshProfile, state.user]);


    const value = useMemo(() => ({
        ...state,
        isAuthenticated: !!state.user,
        signIn,
        signUp,
        verifyOtp,
        signOut,
        signInWithGoogle,
        signInWithGoogleIdToken,
        signInWithGitHub,
        refreshProfile
    }), [state, signOut, refreshProfile]);


    return (
        <AuthContext.Provider value={value as any}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuthContext() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuthContext must be used within an AuthProvider');
    }
    return context;
}
