"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";

import {
  availabilityLabel,
  availabilityOf,
  resolveLive,
  retryPresence,
  statusLabel,
  type Availability,
  type PersonPresence,
} from "@/lib/presence/model";
import { useLiveOnline } from "@/components/presence/live-online";
import { createBatcher } from "@/lib/batcher";
import { queryKeys } from "@/lib/query-keys";

const STALE_MS = 60_000;
const REFRESH_MS = 90_000;
const REALTIME_REFRESH_MS = 5 * 60_000;

// Actions load on first use: avatars and cards that show a badge stay light.
export const actions = () => import("@/app/actions/presence");

const loadPerson = createBatcher<PersonPresence>(async (ids) => {
  const result = await (await actions()).getPresence({ userIds: ids });
  if (!result.success) throw new Error(result.error);
  return new Map(result.presence.map((entry) => [entry.userId, entry]));
});

export type PersonPresenceView = {
  availability: Availability;
  availabilityText: string;
  status: PersonPresence["status"];
  statusText: string | null;
  /** The badge's accessible label: status first, then availability. */
  label: string;
  loaded: boolean;
  /** The data arrived or the request failed: the badge stops loading either way. */
  settled: boolean;
  /** When the data last refreshed: the badge ripples on a change while Active now. */
  updatedAt: number;
  /** Start and end of a timed status, for the badge's timer ring. */
  statusTimer: { setAt: string; expiresAt: string } | null;
};

const NOW_TICK_MS = 30_000;
const nowListeners = new Set<() => void>();
let nowTimer: ReturnType<typeof setInterval> | null = null;
let nowValue = Date.now();

function subscribeNow(listener: () => void) {
  nowValue = Date.now();
  nowListeners.add(listener);
  nowTimer ??= setInterval(() => {
    nowValue = Date.now();
    nowListeners.forEach((notify) => notify());
  }, NOW_TICK_MS);
  return () => {
    nowListeners.delete(listener);
    if (nowListeners.size === 0 && nowTimer) {
      clearInterval(nowTimer);
      nowTimer = null;
    }
  };
}

/** The time, refreshed every 30 s by one shared timer that runs only while something uses it. */
export function useNow(enabled: boolean) {
  return useSyncExternalStore(enabled ? subscribeNow : () => () => {}, () => nowValue, () => nowValue);
}

/**
 * One person's presence. `fallbackLastActiveAt` (already on many payloads)
 * draws the badge before the batch returns; `live` lets chat's realtime
 * presence mark someone Active now immediately.
 */
export function usePersonPresence(userId: string | null | undefined, options: { fallbackLastActiveAt?: string | null; /** Realtime: true/false when known, undefined when not observed. */ live?: boolean } = {}): PersonPresenceView {
  const query = useQuery({
    queryKey: queryKeys.presence.person(userId ?? "none"),
    enabled: Boolean(userId),
    queryFn: () => loadPerson(userId!),
    retry: retryPresence,
    staleTime: STALE_MS,
    // Live online state arrives over Realtime; the read only refreshes status and last-active then.
    refetchInterval: (state) => (state.state.data?.realtime ? REALTIME_REFRESH_MS : REFRESH_MS),
    refetchIntervalInBackground: false,
  });
  // One shared realtime source for every badge; an explicit `live` (the viewer's own badge) wins. Only people
  // the server says Realtime will let us observe get a room: refused joins stall the whole socket (see `realtime`).
  const realtime = useLiveOnline(options.live === undefined && query.data?.realtime ? userId : null);
  return useMemo(() => {
    const data = query.data ?? null;
    const lastActiveAt = data ? data.lastActiveAt : options.fallbackLastActiveAt ?? null;
    const availability = availabilityOf({ live: resolveLive(options.live ?? realtime, data?.live), lastActiveAt });
    const availabilityText = availabilityLabel(availability, lastActiveAt);
    const status = data?.status ?? null;
    const statusText = status ? statusLabel(status) : null;
    const statusLine = status ? [status.emoji, statusText].filter(Boolean).join(" ") : null;
    const statusTimer = status?.setAt && status.expiresAt ? { setAt: status.setAt, expiresAt: status.expiresAt } : null;
    return {
      availability,
      availabilityText,
      status,
      statusText,
      label: statusLine ? `${statusLine} · ${availabilityText}` : availabilityText,
      loaded: Boolean(data),
      settled: Boolean(data) || query.isError,
      updatedAt: query.dataUpdatedAt,
      statusTimer,
    };
  }, [options.fallbackLastActiveAt, options.live, realtime, query.data, query.dataUpdatedAt, query.isError]);
}
