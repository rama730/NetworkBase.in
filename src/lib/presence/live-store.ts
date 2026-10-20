import type { PresenceServerEvent } from "@/lib/realtime/presence-types";

type RoomHandle = { unsubscribe(): void };
type RoomStatus = "connecting" | "connected" | "disconnected" | "error";
type SubscribeRoom = (params: {
  roomType: "user";
  roomId: string;
  role: "viewer";
  onEvent: (event: PresenceServerEvent) => void;
  onStatus: (status: RoomStatus) => void;
}) => RoomHandle;

type Entry = {
  id: string;
  refs: number;
  /** The owner's live sockets (several devices count); online is `size > 0`. */
  connectionIds: Set<string>;
  /** `undefined` = realtime does not know, so the server value is used. */
  online: boolean | undefined;
  connected: boolean;
  sub: RoomHandle | null;
  cancelPending: (() => void) | null;
  deniedUntil: number;
};

/**
 * Who is online right now, from Supabase presence rooms `presence:user:<id>`, shared by
 * every badge in the app. Realtime only answers for people the SQL rule lets you observe
 * (activity visible both ways and a shared chat or project); for anyone else the value stays
 * `undefined` and the batched server presence is used.
 *
 * ponytail: `max` rooms, first come first served with FIFO promotion (they share one socket with
 * chat). Upgrade: subscribe only for badges that are on screen.
 */
export function createLiveStore(deps: {
  subscribeRoom: SubscribeRoom;
  max?: number;
  deniedMs?: number;
  debounceMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
}) {
  const max = deps.max ?? 12;
  const deniedMs = deps.deniedMs ?? 60_000;
  const debounceMs = deps.debounceMs ?? 300;
  const now = deps.now ?? Date.now;
  const schedule = deps.schedule ?? ((fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  });

  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<() => void>>();
  const queue: string[] = [];
  let ready = false;
  let self: string | null = null;

  const notify = (id: string) => listeners.get(id)?.forEach((listener) => listener());
  const slots = () => {
    let used = 0;
    for (const entry of entries.values()) if (entry.sub || entry.cancelPending) used += 1;
    return used;
  };
  const setOnline = (entry: Entry, online: boolean | undefined) => {
    if (entry.online === online) return;
    entry.online = online;
    notify(entry.id);
  };

  function release(entry: Entry, denyUntil = 0) {
    entry.cancelPending?.();
    entry.cancelPending = null;
    entry.sub?.unsubscribe();
    entry.sub = null;
    entry.connected = false;
    entry.connectionIds.clear();
    if (denyUntil) entry.deniedUntil = denyUntil;
    setOnline(entry, undefined);
    promote();
  }

  function promote() {
    while (queue.length > 0 && slots() < max) {
      const entry = entries.get(queue.shift()!);
      if (entry) connect(entry);
    }
  }

  function connect(entry: Entry) {
    if (!ready || entry.refs === 0 || entry.sub || entry.cancelPending || entry.id === self) return;
    if (now() < entry.deniedUntil) return;
    if (slots() >= max) {
      if (!queue.includes(entry.id)) queue.push(entry.id);
      return;
    }
    // A short wait so a list scrolling past (or a StrictMode remount) never opens and closes channels.
    entry.cancelPending = schedule(() => {
      entry.cancelPending = null;
      open(entry);
    }, debounceMs);
  }

  function open(entry: Entry) {
    if (!ready || entry.refs === 0) {
      promote();
      return;
    }
    let failed = false;
    const handle = deps.subscribeRoom({
      roomType: "user",
      roomId: entry.id,
      role: "viewer",
      onEvent: (event) => {
        // presence-client replays its last snapshot on subscribe, even for a room that has since dropped.
        if (!entry.connected) return;
        if (event.type === "presence.state") {
          entry.connectionIds.clear();
          for (const member of event.members) if (member.userId === entry.id) entry.connectionIds.add(member.connectionId);
        } else if (event.type === "presence.delta" && event.member.userId === entry.id) {
          if (event.action === "upsert") entry.connectionIds.add(event.member.connectionId);
          else entry.connectionIds.delete(event.member.connectionId);
        } else {
          return;
        }
        setOnline(entry, entry.connectionIds.size > 0);
      },
      onStatus: (status) => {
        if (status === "error") {
          // Denied by the SQL rule, or a failure that looks the same: stop, and do not retry for a while.
          failed = true;
          entry.deniedUntil = now() + deniedMs;
          if (entry.sub) release(entry, entry.deniedUntil);
          return;
        }
        entry.connected = status === "connected";
        if (status === "disconnected") {
          // Unknown (not offline): the server value is used until presence-client reconnects and re-sends a snapshot.
          entry.connectionIds.clear();
          setOnline(entry, undefined);
        }
      },
    });
    if (failed) {
      handle.unsubscribe();
      promote();
      return;
    }
    entry.sub = handle;
  }

  return {
    /** Nothing subscribes until the viewer is signed in with a Realtime token. */
    setReady(next: boolean) {
      if (next === ready) return;
      ready = next;
      if (!ready) {
        queue.length = 0;
        for (const entry of entries.values()) release(entry);
      } else {
        for (const entry of entries.values()) connect(entry);
      }
    },
    /** The viewer is always online to themself (their publisher stops when the tab idles or is hidden). */
    setSelf(id: string | null) {
      const previous = self;
      self = id;
      if (previous) notify(previous);
      if (id) notify(id);
    },
    /** Count a watcher of `id`; returns the release function. */
    watch(id: string) {
      let entry = entries.get(id);
      if (!entry) {
        entry = { id, refs: 0, connectionIds: new Set(), online: undefined, connected: false, sub: null, cancelPending: null, deniedUntil: 0 };
        entries.set(id, entry);
      }
      entry.refs += 1;
      connect(entry);
      const owned = entry;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        owned.refs -= 1;
        if (owned.refs > 0) return;
        release(owned);
        if (now() >= owned.deniedUntil) entries.delete(id);
      };
    },
    get(id: string): boolean | undefined {
      if (ready && id === self) return true;
      return entries.get(id)?.online;
    },
    listen(id: string, listener: () => void) {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(id);
      };
    },
  };
}
