"use client";

import { useCallback, useSyncExternalStore } from "react";

import { createLiveStore } from "@/lib/presence/live-store";
import { subscribePresenceRoom } from "@/lib/realtime/presence-client";

/** The one shared "who is online right now" store: every badge reads it through `usePersonPresence`. */
export const liveStore = createLiveStore({ subscribeRoom: subscribePresenceRoom });

/** Realtime online state of a person: `true`/`false`, or `undefined` when realtime does not know (use the server value). */
export function useLiveOnline(userId: string | null | undefined) {
  const subscribe = useCallback((onChange: () => void) => {
    if (!userId) return () => {};
    const stopListening = liveStore.listen(userId, onChange);
    const release = liveStore.watch(userId);
    return () => {
      stopListening();
      release();
    };
  }, [userId]);
  return useSyncExternalStore(subscribe, () => (userId ? liveStore.get(userId) : undefined), () => undefined);
}
