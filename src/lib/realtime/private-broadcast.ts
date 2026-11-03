"use client";

import { REALTIME_SUBSCRIBE_STATES, type AuthChangeEvent, type RealtimeChannel, type Session } from "@supabase/supabase-js";

import { bootstrapBrowserSessionFromServer } from "@/lib/auth/browser-auth-actions";
import { createClient } from "@/lib/supabase/client";
import { isPrivateRealtimeAuthorizationEnabled } from "./authorization";

export type BroadcastStatus = "connecting" | "connected" | "disconnected" | "disabled";
type EventHandler = (event: string, payload: Record<string, unknown>) => void;
type StatusHandler = (status: BroadcastStatus) => void;

type Entry = {
  channel: RealtimeChannel;
  handlers: Set<EventHandler>;
  statusHandlers: Set<StatusHandler>;
  status: BroadcastStatus;
  releaseTimer: ReturnType<typeof setTimeout> | null;
};

const RELEASE_GRACE_MS = 1_500;
const entries = new Map<string, Entry>();

function setStatus(entry: Entry, status: BroadcastStatus) {
  entry.status = status;
  entry.statusHandlers.forEach((handler) => handler(status));
}

type Client = ReturnType<typeof createClient>;
let restoring: Promise<string | null> | null = null;

function waitForSession(supabase: Client, ms: number) {
  return new Promise<string | null>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (!session?.access_token) return;
      if (timer) clearTimeout(timer);
      data.subscription.unsubscribe();
      resolve(session.access_token);
    });
    timer = setTimeout(() => {
      data.subscription.unsubscribe();
      resolve(null);
    }, ms);
  });
}

/**
 * A user JWT for private topics. Never the anon key: every private topic
 * rejects it, and supabase-js falls back to it when the browser has no session.
 * AuthProvider copies the server's (httpOnly) session into the browser; if that
 * has not landed, wait briefly, then restore it here once.
 */
/**
 * A private channel the caller wires itself, for a screen that needs presence and broadcast on one topic (the trust
 * console). The token is set first; null without a session. Shared topics should use subscribeBroadcast instead.
 */
export async function openPrivateChannel(topic: string, config: Record<string, unknown> = {}): Promise<RealtimeChannel | null> {
  const token = await realtimeUserToken();
  if (!token) return null;
  const supabase = createClient();
  await supabase.realtime.setAuth(token);
  return supabase.channel(topic, { config: { ...config, private: true } });
}

export async function realtimeUserToken(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) return data.session.access_token;
  restoring ??= (async () => {
    const token = await waitForSession(supabase, 3_000);
    if (token) return token;
    const session = await bootstrapBrowserSessionFromServer().catch(() => null);
    if (!session) return null;
    const { data: restored } = await supabase.auth.setSession(session);
    return restored.session?.access_token ?? null;
  })().finally(() => {
    restoring = null;
  });
  const token = await restoring;
  if (!token && process.env.NODE_ENV === "development") {
    console.warn("[realtime] no browser session, so chat live updates are off. Look for auth.session.bootstrap_failed above.");
  }
  return token;
}

function join(topic: string, entry: Entry) {
  const supabase = createClient();
  void (async () => {
    const token = await realtimeUserToken();
    if (entries.get(topic) !== entry) return;
    if (!token) return setStatus(entry, "disconnected");
    await supabase.realtime.setAuth(token);
    entry.channel.subscribe((status: `${REALTIME_SUBSCRIBE_STATES}`) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) setStatus(entry, "connected");
      else setStatus(entry, "disconnected");
    });
  })().catch(() => setStatus(entry, "disconnected"));
}

function open(topic: string): Entry {
  const supabase = createClient();
  const channel = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } });
  const entry: Entry = { channel, handlers: new Set(), statusHandlers: new Set(), status: "connecting", releaseTimer: null };
  channel.on("broadcast", { event: "*" }, (message: { event: string; payload?: Record<string, unknown> }) => {
    entry.handlers.forEach((handler) => handler(message.event, message.payload ?? {}));
  });
  join(topic, entry);
  return entry;
}

// ponytail: delivery p95 was not soak-tested on the free plan (L-33).
// upgrade: re-run the 5,000-client soak on Pro before launch traffic.
/**
 * Join a private Broadcast topic (chat:channel:<id>, chat:user:<id>). Topics are
 * shared and ref-counted per tab; supabase-js rejoins after drops with the
 * jittered backoff configured on the browser client. With Realtime
 * authorization switched off, this is a no-op and chat falls back to polling.
 */
export function subscribeBroadcast(topic: string, onEvent: EventHandler, onStatus?: StatusHandler) {
  if (!isPrivateRealtimeAuthorizationEnabled()) {
    onStatus?.("disabled");
    return { send: () => false, unsubscribe: () => undefined };
  }
  const existing = entries.get(topic);
  const entry = existing ?? open(topic);
  entries.set(topic, entry);
  // A join that never got a session has nothing to retry it; a new subscriber (or "Retry") does.
  if (existing?.status === "disconnected" && existing.channel.state === "closed") {
    setStatus(existing, "connecting");
    join(topic, existing);
  }
  if (entry.releaseTimer) {
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
  }
  entry.handlers.add(onEvent);
  if (onStatus) {
    entry.statusHandlers.add(onStatus);
    onStatus(entry.status);
  }
  return {
    /** False when not connected yet (the event is dropped, not queued). */
    send(event: string, payload: Record<string, unknown>) {
      if (entry.status !== "connected") return false;
      void entry.channel.send({ type: "broadcast", event, payload });
      return true;
    },
    unsubscribe() {
      entry.handlers.delete(onEvent);
      if (onStatus) entry.statusHandlers.delete(onStatus);
      if (entry.handlers.size > 0 || entry.releaseTimer) return;
      entry.releaseTimer = setTimeout(() => {
        if (entry.handlers.size > 0) return;
        entries.delete(topic);
        void createClient().removeChannel(entry.channel);
      }, RELEASE_GRACE_MS);
    },
  };
}
