import assert from "node:assert/strict";
import test from "node:test";

import { createLiveStore } from "@/lib/presence/live-store";

type Fake = {
  id: string;
  unsubscribed: boolean;
  onEvent: (event: unknown) => void;
  onStatus: (status: string) => void;
};

/** A store wired to a fake presence client and a manual clock, so every ordering is deterministic. */
function setup(options: { max?: number; deniedMs?: number } = {}) {
  const rooms: Fake[] = [];
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  let clock = 0;
  const store = createLiveStore({
    max: options.max ?? 12,
    deniedMs: options.deniedMs ?? 60_000,
    debounceMs: 300,
    now: () => clock,
    schedule: (fn, ms) => {
      const timer = { at: clock + ms, fn, live: true };
      timers.push(timer);
      return () => { timer.live = false; };
    },
    subscribeRoom: ({ roomId, onEvent, onStatus }) => {
      const room: Fake = { id: roomId, unsubscribed: false, onEvent: onEvent as Fake["onEvent"], onStatus: onStatus as Fake["onStatus"] };
      rooms.push(room);
      return { unsubscribe: () => { room.unsubscribed = true; } };
    },
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const timer of timers.splice(0)) {
      if (timer.live && timer.at <= clock) timer.fn();
      else if (timer.live) timers.push(timer);
    }
  };
  const open = (id: string) => rooms.filter((room) => room.id === id && !room.unsubscribed);
  const state = (room: Fake, owner: string, connectionIds: string[]) =>
    room.onEvent({ type: "presence.state", roomType: "user", roomId: owner, members: connectionIds.map((connectionId) => ({ connectionId, userId: owner })) });
  const delta = (room: Fake, owner: string, action: "upsert" | "leave", connectionId: string, userId = owner) =>
    room.onEvent({ type: "presence.delta", action, roomType: "user", roomId: owner, member: { connectionId, userId } });
  return { store, rooms, advance, open, state, delta };
}

test("nothing subscribes until ready, then a watched id joins after the debounce", () => {
  const { store, rooms, advance } = setup();
  store.watch("a");
  advance(300);
  assert.equal(rooms.length, 0);
  store.setReady(true);
  assert.equal(rooms.length, 0);
  advance(300);
  assert.equal(rooms.length, 1);
  assert.equal(store.get("a"), undefined);
});

test("snapshot, join and leave decide online; an empty room is false; several devices count", () => {
  const { store, advance, open, state, delta } = setup();
  store.setReady(true);
  store.watch("a");
  advance(300);
  const room = open("a")[0];
  room.onStatus("connected");
  state(room, "a", []);
  assert.equal(store.get("a"), false);
  delta(room, "a", "upsert", "c1");
  delta(room, "a", "upsert", "c2");
  assert.equal(store.get("a"), true);
  delta(room, "a", "leave", "c1");
  assert.equal(store.get("a"), true);
  delta(room, "a", "leave", "c2");
  assert.equal(store.get("a"), false);
  // Viewers' own joins are not the owner's connections.
  delta(room, "a", "upsert", "v1", "someone-else");
  assert.equal(store.get("a"), false);
});

test("events are ignored while the room is not connected (a replayed stale snapshot cannot revive it)", () => {
  const { store, advance, open, state } = setup();
  store.setReady(true);
  store.watch("a");
  advance(300);
  const room = open("a")[0];
  room.onStatus("connected");
  state(room, "a", ["c1"]);
  assert.equal(store.get("a"), true);
  room.onStatus("disconnected");
  assert.equal(store.get("a"), undefined);
  state(room, "a", ["c1"]);
  assert.equal(store.get("a"), undefined);
  room.onStatus("connected");
  state(room, "a", ["c1"]);
  assert.equal(store.get("a"), true);
});

test("an error drops the room, falls back to unknown, and is not retried for a minute", () => {
  const { store, rooms, advance, open } = setup();
  store.setReady(true);
  const unwatch = store.watch("a");
  advance(300);
  open("a")[0].onStatus("error");
  assert.equal(store.get("a"), undefined);
  assert.equal(rooms[0].unsubscribed, true);
  unwatch();
  store.watch("a");
  advance(300);
  assert.equal(rooms.length, 1);
  advance(60_000);
  store.watch("a");
  advance(300);
  assert.equal(rooms.length, 2);
});

test("two watchers of one id share one subscription; the last release closes it", () => {
  const { store, rooms, advance } = setup();
  store.setReady(true);
  const first = store.watch("a");
  const second = store.watch("a");
  advance(300);
  assert.equal(rooms.length, 1);
  first();
  assert.equal(rooms[0].unsubscribed, false);
  second();
  assert.equal(rooms[0].unsubscribed, true);
});

test("a watch released before the debounce never opens a channel", () => {
  const { store, rooms, advance } = setup();
  store.setReady(true);
  store.watch("a")();
  advance(1000);
  assert.equal(rooms.length, 0);
});

test("the cap holds: extra ids wait in order and are promoted when a slot frees", () => {
  const { store, rooms, advance } = setup({ max: 2 });
  store.setReady(true);
  const releases = ["a", "b", "c", "d"].map((id) => store.watch(id));
  advance(300);
  assert.deepEqual(rooms.map((room) => room.id), ["a", "b"]);
  releases[0]();
  advance(300);
  assert.deepEqual(rooms.map((room) => room.id), ["a", "b", "c"]);
  releases[1]();
  advance(300);
  assert.deepEqual(rooms.map((room) => room.id), ["a", "b", "c", "d"]);
});

test("an id that is still watched is never evicted for a newcomer", () => {
  const { store, rooms, advance } = setup({ max: 1 });
  store.setReady(true);
  store.watch("a");
  advance(300);
  store.watch("b");
  advance(300);
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].unsubscribed, false);
});

test("the viewer's own id is always online and never subscribed", () => {
  const { store, rooms, advance } = setup();
  store.setReady(true);
  store.setSelf("me");
  store.watch("me");
  advance(300);
  assert.equal(store.get("me"), true);
  assert.equal(rooms.length, 0);
});

test("not ready again drops every room and value", () => {
  const { store, rooms, advance, open, state } = setup();
  store.setReady(true);
  store.watch("a");
  advance(300);
  const room = open("a")[0];
  room.onStatus("connected");
  state(room, "a", ["c1"]);
  assert.equal(store.get("a"), true);
  store.setReady(false);
  assert.equal(rooms[0].unsubscribed, true);
  assert.equal(store.get("a"), undefined);
});

test("a change wakes only the listeners of that person", () => {
  const { store, advance, open, state } = setup();
  store.setReady(true);
  const calls: string[] = [];
  store.listen("a", () => calls.push("a"));
  store.listen("b", () => calls.push("b"));
  store.watch("a");
  advance(300);
  const room = open("a")[0];
  room.onStatus("connected");
  state(room, "a", ["c1"]);
  assert.deepEqual(calls, ["a"]);
  state(room, "a", ["c1"]);
  assert.deepEqual(calls, ["a"]);
});
