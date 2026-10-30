import type { Session, User } from '@supabase/supabase-js';
import { buildOAuthRedirectTo, normalizeAuthNextPath, resolveAuthBaseUrl } from '@/lib/auth/redirects';
import { continueBrowserOAuthRedirect } from '@/lib/auth/oauth';

const AUTH_SIGN_IN_TIMEOUT_MS = 8_000;
const AUTH_UNREACHABLE_MESSAGE = 'Authentication service is unavailable. Check your Supabase connection and try again.';

export interface AuthResult {
    data: { user: User | null; session: Session | null } | null;
    error: { message: string } | null;
}

export interface OAuthResult {
    data: { url: string } | null;
    error: { message: string } | null;
}

type SignUpApiResponse = {
    success: boolean;
    data?: {
        session?: { accessToken?: string | null; refreshToken?: string | null } | null;
        user?: { id: string; email?: string | null } | null;
    };
    message?: string;
};

export type SignUpOptions = {
    suggestedUsername?: string;
    inviteToken?: string;
    website_hp?: string;
    idempotencyKey?: string;
};

export async function loadBrowserSupabase() {
    const { createClient } = await import('@/lib/supabase/client');
    return createClient();
}

let lastSyncedSessionToken: string | null = null;

export async function syncBrowserSessionToServer(session: Session | null) {
    const token = session ? `${session.access_token}:${session.refresh_token}` : null;
    if (session && token === lastSyncedSessionToken) return;

    const response = await fetch('/api/v1/auth/session', {
        method: session ? 'POST' : 'DELETE',
        headers: session ? { 'content-type': 'application/json' } : undefined,
        credentials: 'same-origin',
        body: session
            ? JSON.stringify({ mode: 'sync', accessToken: session.access_token, refreshToken: session.refresh_token })
            : undefined,
    });

    if (!response.ok) {
        if (response.status === 400 || response.status === 401) {
            const supabase = await loadBrowserSupabase();
            await supabase.auth.signOut({ scope: 'local' }).catch(() => null);
        }
        throw new Error(`Browser session sync failed (${response.status})`);
    }

    lastSyncedSessionToken = token;
}

type BrowserSessionBridgeResponse = {
    data?: {
        session?: {
            accessToken?: string | null;
            refreshToken?: string | null;
            expiresAt?: number | null;
        } | null;
    } | null;
    error?: string;
};

/** The server's session (httpOnly cookies) as tokens the browser client can adopt. */
export async function bootstrapBrowserSessionFromServer() {
    const response = await fetch('/api/v1/auth/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ mode: 'bootstrap' }),
    });

    if (!response.ok) {
        throw new Error(`Browser session bootstrap failed (${response.status})`);
    }

    const body = await response.json().catch(() => null) as BrowserSessionBridgeResponse | null;
    const accessToken = body?.data?.session?.accessToken?.trim() || '';
    const refreshToken = body?.data?.session?.refreshToken?.trim() || '';
    if (!accessToken || !refreshToken) return null;

    return {
        access_token: accessToken,
        refresh_token: refreshToken,
    };
}

/**
 * The code step after Google or GitHub, a refreshed code page, or a new tab: the session (still waiting for its second
 * factor) lives only in the server's cookies, and the server reports no user until the code is in, so nothing else
 * copies it here. Adopt it, or the code can't be checked at all.
 */
export async function adoptServerSessionIfMissing() {
    const supabase = await loadBrowserSupabase();
    const { data } = await supabase.auth.getSession();
    if (data.session) return true;
    const serverSession = await bootstrapBrowserSessionFromServer().catch(() => null);
    if (!serverSession) return false;
    const { error } = await supabase.auth.setSession(serverSession);
    return !error;
}

export function forgetSyncedBrowserSession() {
    lastSyncedSessionToken = null;
}

function isConnectivityMessage(message: string) {
    const normalized = message.toLowerCase();
    return normalized === 'auth_timeout' || normalized.includes('fetch failed') || normalized.includes('timeout') || normalized.includes('network');
}

export async function signInWithPassword(email: string, password: string, captchaToken?: string): Promise<AuthResult> {
    try {
        const supabase = await loadBrowserSupabase();
        const result = await Promise.race([
            supabase.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : undefined }),
            new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('AUTH_TIMEOUT')), AUTH_SIGN_IN_TIMEOUT_MS);
            }),
        ]);
        if (!result.error) {
            if (result.data.session) await syncBrowserSessionToServer(result.data.session).catch(() => null);
            return result;
        }
        if (isConnectivityMessage(result.error.message || '')) {
            return { data: null, error: { message: AUTH_UNREACHABLE_MESSAGE } };
        }
        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        return { data: null, error: { message: isConnectivityMessage(message) ? AUTH_UNREACHABLE_MESSAGE : 'Sign in failed' } };
    }
}

export async function signUpWithPassword(
    email: string,
    password: string,
    fullName?: string,
    captchaToken?: string,
    legalAccepted?: boolean,
    options?: SignUpOptions,
): Promise<AuthResult> {
    try {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (options?.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
        const response = await fetch('/api/v1/auth/signup', {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            body: JSON.stringify({
                email,
                password,
                fullName,
                legalAccepted,
                ...(options?.suggestedUsername ? { suggestedUsername: options.suggestedUsername } : {}),
                ...(options?.inviteToken ? { inviteToken: options.inviteToken } : {}),
                ...(options?.website_hp ? { website_hp: options.website_hp } : {}),
                ...(captchaToken ? { captchaToken } : {}),
            }),
        });
        const body = await response.json().catch(() => null) as SignUpApiResponse | null;
        if (!response.ok || body?.success === false) {
            return { data: null, error: { message: body?.message || 'Couldn’t create account' } };
        }

        const sessionPayload = body?.data?.session;
        if (sessionPayload?.accessToken && sessionPayload.refreshToken) {
            const supabase = await loadBrowserSupabase();
            const result = await supabase.auth.setSession({
                access_token: sessionPayload.accessToken,
                refresh_token: sessionPayload.refreshToken,
            });
            if (result.error) {
                return { data: null, error: { message: result.error.message || 'Couldn’t establish session' } };
            }
            if (result.data.session) await syncBrowserSessionToServer(result.data.session).catch(() => null);
            return result;
        }

        return {
            data: {
                user: body?.data?.user ? ({ id: body.data.user.id, email: body.data.user.email ?? undefined } as User) : null,
                session: null,
            },
            error: null,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        return { data: null, error: { message: isConnectivityMessage(message) ? AUTH_UNREACHABLE_MESSAGE : 'Couldn’t create account' } };
    }
}

export async function verifyEmailOtp(email: string, token: string, type: 'signup' | 'email' = 'signup'): Promise<AuthResult> {
    try {
        const supabase = await loadBrowserSupabase();
        const result = await supabase.auth.verifyOtp({ email: email.trim(), token: token.trim(), type });
        if (result.error) {
            return { data: null, error: { message: result.error.message || 'Invalid or expired verification code' } };
        }
        if (result.data.session) await syncBrowserSessionToServer(result.data.session).catch(() => null);
        return { data: result.data, error: null };
    } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : 'Verification failed' } };
    }
}

function createAuthRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `auth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function startOAuthSignIn(provider: 'google' | 'github', nextPath?: string | null): Promise<OAuthResult> {
    const supabase = await loadBrowserSupabase();
    const redirectTo = buildOAuthRedirectTo(resolveAuthBaseUrl(), normalizeAuthNextPath(nextPath), createAuthRequestId(), provider);
    const result = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (!result.error) continueBrowserOAuthRedirect(result);
    return result;
}

export async function signInWithGoogleIdToken(token: string, nonce: string): Promise<AuthResult> {
    try {
        const supabase = await loadBrowserSupabase();
        const result = await supabase.auth.signInWithIdToken({ provider: 'google', token, nonce });
        if (result.error) {
            return { data: result.data, error: { message: result.error.message || 'Couldn’t complete Google sign-in' } };
        }
        if (result.data.session) await syncBrowserSessionToServer(result.data.session);
        return { data: result.data, error: null };
    } catch {
        return { data: null, error: { message: 'Couldn’t complete Google sign-in' } };
    }
}
