"use client";

import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel } from "@supabase/supabase-js";

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

function open(topic: string): Entry {
  const supabase = createClient();
  const channel = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } });
  const entry: Entry = { channel, handlers: new Set(), statusHandlers: new Set(), status: "connecting", releaseTimer: null };
  channel.on("broadcast", { event: "*" }, (message: { event: string; payload?: Record<string, unknown> }) => {
    entry.handlers.forEach((handler) => handler(message.event, message.payload ?? {}));
  });
  void (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) await supabase.realtime.setAuth(data.session.access_token);
    channel.subscribe((status: `${REALTIME_SUBSCRIBE_STATES}`) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) setStatus(entry, "connected");
      else setStatus(entry, "disconnected");
    });
  })().catch(() => setStatus(entry, "disconnected"));
  return entry;
}

/**
 * Join a private Broadcast topic (chat:channel:<id>, chat:user:<id>). Topics are
 * shared and ref-counted per tab; supabase-js rejoins after drops with the
 * jittered backoff configured on the browser client. With Realtime
 * authorization switched off, this is a no-op and chat falls back to polling.
 */
export function subscribeBroadcast(topic: string, onEvent: EventHandler, onStatus?: StatusHandler) {
  if (!isPrivateRealtimeAuthorizationEnabled()) {
    onStatus?.("disabled");
    return { send: () => undefined, unsubscribe: () => undefined };
  }
  const entry = entries.get(topic) ?? open(topic);
  entries.set(topic, entry);
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
    send(event: string, payload: Record<string, unknown>) {
      if (entry.status === "connected") void entry.channel.send({ type: "broadcast", event, payload });
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
