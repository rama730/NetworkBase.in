import { createBrowserClient } from '@supabase/ssr'
import { resolveSupabasePublicEnv } from '@/lib/supabase/env'
import { browserSessionCookieStore, clearLegacySupabaseBrowserCookies } from '@/lib/supabase/browser-cookie-store'

let client: ReturnType<typeof createBrowserClient> | undefined;

const RECONNECT_STEPS_MS = [1_000, 2_000, 5_000, 10_000];

/** supabase-js backoff steps with ±50% jitter, capped at 15 s. */
export function realtimeReconnectDelay(tries: number) {
  const base = RECONNECT_STEPS_MS[Math.max(0, tries - 1)] ?? 10_000;
  return Math.min(15_000, Math.round(base * (0.5 + Math.random())));
}

export function createClient() {
  if (client) return client;
  const env = resolveSupabasePublicEnv('supabase.browser')
  clearLegacySupabaseBrowserCookies()

  client = createBrowserClient(
    env.url,
    env.anonKey,
    {
      cookies: browserSessionCookieStore,
      auth: {
        persistSession: typeof window !== 'undefined' && window.self === window.top,
      },
      realtime: {
        // Jittered backoff so many tabs do not rejoin in lockstep after an
        // outage (Realtime allows a fixed number of channel joins per second).
        reconnectAfterMs: realtimeReconnectDelay,
      },
    }
  )
  return client;
}

export const createSupabaseBrowserClient = createClient
