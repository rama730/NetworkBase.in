"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";

import {
  availabilityLabel,
  availabilityOf,
  projectAvailabilityOf,
  resolveLive,
  retryPresence,
  statusLabel,
  type Availability,
  type PersonPresence,
  type WorkspaceStatus,
} from "@/lib/presence/model";
import { useLiveOnline } from "@/components/presence/live-online";
import { queryKeys } from "@/lib/query-keys";

const STALE_MS = 60_000;
const REFRESH_MS = 90_000;
const BATCH_WINDOW_MS = 16;
const BATCH_MAX = 100;

/**
 * Collects ids requested in the same tick into one server call (≤100 per
 * call), so a page of 40 cards makes one request, not 40.
 */
function createBatcher<T>(load: (ids: string[]) => Promise<Map<string, T>>) {
  let pending = new Map<string, Array<{ resolve: (value: T | null) => void; reject: (error: unknown) => void }>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async () => {
    const batch = pending;
    pending = new Map();
    timer = null;
    const ids = Array.from(batch.keys());
    for (let index = 0; index < ids.length; index += BATCH_MAX) {
      const slice = ids.slice(index, index + BATCH_MAX);
      try {
        const map = await load(slice);
        for (const id of slice) batch.get(id)?.forEach((waiter) => waiter.resolve(map.get(id) ?? null));
      } catch (error) {
        for (const id of slice) batch.get(id)?.forEach((waiter) => waiter.reject(error));
      }
    }
  };
  return (id: string) => new Promise<T | null>((resolve, reject) => {
    const waiters = pending.get(id) ?? [];
    waiters.push({ resolve, reject });
    pending.set(id, waiters);
    timer ??= setTimeout(() => void flush(), BATCH_WINDOW_MS);
  });
}

// Actions load on first use: avatars and cards that show a badge stay light.
export const actions = () => import("@/app/actions/presence");

const loadPerson = createBatcher<PersonPresence>(async (ids) => {
  const result = await (await actions()).getPresence({ userIds: ids });
  if (!result.success) throw new Error(result.error);
  return new Map(result.presence.map((entry) => [entry.userId, entry]));
});

type ProjectPresenceEntry = { projectId: string; updatedAt: string | null; status: WorkspaceStatus | null };
const loadProject = createBatcher<ProjectPresenceEntry>(async (ids) => {
  const result = await (await actions()).getWorkspaceStatuses({ projectIds: ids });
  if (!result.success) throw new Error("unavailable");
  return new Map(result.projects.map((entry) => [entry.projectId, entry]));
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
    refetchInterval: REFRESH_MS,
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

export function useWorkspacePresence(projectId: string | null | undefined, fallbackUpdatedAt?: string | Date | null) {
  const query = useQuery({
    queryKey: queryKeys.presence.project(projectId ?? "none"),
    enabled: Boolean(projectId),
    queryFn: () => loadProject(projectId!),
    staleTime: STALE_MS,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  return useMemo(() => {
    const updatedAt = query.data?.updatedAt ?? (fallbackUpdatedAt ? new Date(fallbackUpdatedAt).toISOString() : null);
    const availability = projectAvailabilityOf(updatedAt);
    const availabilityText = availabilityLabel(availability, updatedAt);
    const status = query.data?.status ?? null;
    const statusText = status ? statusLabel(status) : null;
    const statusLine = status ? [status.emoji, statusText].filter(Boolean).join(" ") : null;
    return { availability, availabilityText, status, statusText, statusLine, label: statusLine ? `${statusLine} · ${availabilityText}` : availabilityText };
  }, [fallbackUpdatedAt, query.data]);
}
