import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Inngest } from "inngest";

import { wakeAt, wakeChatDueIfSoon, wakeEvent, wakePushIfNeeded } from "../../src/inngest/wake";

type Sent = { name: string; data: unknown; id: string; ts: number };

function recorder() {
  const sent: Sent[] = [];
  return { sent, client: { send: async (event: Sent) => { sent.push(event); return { ids: [] }; } } };
}

const MINUTE = 60_000;

describe("wakeAt", () => {
  it("starts the job just after the next whole minute", async () => {
    const { sent, client } = recorder();
    await wakeAt("chat/due.wake", new Date("2026-11-01T10:15:20.000Z"), client);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].name, "chat/due.wake");
    assert.equal(sent[0].ts, Date.parse("2026-11-01T10:16:05.000Z"));
  });

  it("gives every wake in one minute the same id, so a burst starts one run", async () => {
    const { sent, client } = recorder();
    await wakeAt("notification/push.wake", new Date("2026-11-01T10:15:20.000Z"), client);
    await wakeAt("notification/push.wake", new Date("2026-11-01T10:15:59.000Z"), client);
    assert.equal(sent[0].id, sent[1].id);
  });

  it("does not share an id between different jobs or different minutes", async () => {
    const { sent, client } = recorder();
    await wakeAt("chat/due.wake", new Date("2026-11-01T10:15:20.000Z"), client);
    await wakeAt("notification/push.wake", new Date("2026-11-01T10:15:20.000Z"), client);
    await wakeAt("chat/due.wake", new Date("2026-11-01T10:16:20.000Z"), client);
    assert.equal(new Set(sent.map((event) => event.id)).size, 3);
  });

  it("runs a time on the minute just after it, so a clock difference cannot run it too early", async () => {
    const { sent, client } = recorder();
    await wakeAt("chat/due.wake", new Date("2026-11-01T10:15:00.000Z"), client);
    assert.equal(sent[0].ts, Date.parse("2026-11-01T10:15:05.000Z"));
  });

  it("sends exactly the event the sweep's step sends, so the two share an id", async () => {
    const { sent, client } = recorder();
    const at = new Date("2026-11-01T10:15:20.000Z");
    await wakeAt("chat/due.wake", at, client);
    assert.deepEqual(sent[0], wakeEvent("chat/due.wake", at));
  });

  it("never throws when Inngest fails", async () => {
    const client = { send: async () => { throw new Error("limit reached"); } };
    await assert.doesNotReject(wakeAt("chat/due.wake", new Date(), client));
  });

  it("gives up within about a second when Inngest does not answer", async () => {
    const client = { send: () => new Promise<never>(() => {}) };
    const started = Date.now();
    await wakeAt("chat/due.wake", new Date(), client);
    assert.ok(Date.now() - started < 1_500);
  });
});

describe("wakeAt through Inngest's real client", () => {
  it("sends the start time and the id in the event", async () => {
    const bodies: unknown[] = [];
    const client = new Inngest({
      id: "wake-test",
      eventKey: "test-key",
      baseUrl: "https://inngest.invalid",
      isDev: false,
      fetch: (async (_url: unknown, init: { body: string }) => {
        bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ ids: ["1"], status: 200 }), { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });
    await wakeAt("chat/due.wake", new Date("2026-11-01T10:15:20.000Z"), client as never);
    const [event] = (bodies[0] as Array<{ name: string; id: string; ts: number }>);
    assert.equal(event!.name, "chat/due.wake");
    assert.equal(event!.ts, Date.parse("2026-11-01T10:16:05.000Z"));
    assert.equal(event!.id, `chat/due.wake:${Date.parse("2026-11-01T10:16:00.000Z")}`);
  });
});

describe("wakeChatDueIfSoon", () => {
  const now = new Date("2026-11-01T10:00:00.000Z");

  it("wakes for something due within the hour", async () => {
    const { sent, client } = recorder();
    await wakeChatDueIfSoon(new Date(now.getTime() + 10 * MINUTE), now, client);
    assert.equal(sent.length, 1);
  });

  it("leaves anything further ahead to the hourly sweep, which arms it", async () => {
    const { sent, client } = recorder();
    await wakeChatDueIfSoon(new Date(now.getTime() + 8 * 24 * 60 * MINUTE), now, client);
    assert.equal(sent.length, 0);
  });

  it("wakes for a time just past the sweep's hour, so nothing falls between sweeps", async () => {
    const { sent, client } = recorder();
    await wakeChatDueIfSoon(new Date(now.getTime() + 64 * MINUTE), now, client);
    assert.equal(sent.length, 1);
  });
});

describe("wakePushIfNeeded", () => {
  const now = new Date("2026-11-01T10:00:20.000Z");

  it("wakes about a minute ahead for an important notification, after its transaction can commit", async () => {
    const { sent, client } = recorder();
    await wakePushIfNeeded({ importance: "important", delayUntil: null }, now, client);
    assert.equal(sent[0].name, "notification/push.wake");
    assert.ok(sent[0].ts >= now.getTime() + 30_000);
    assert.ok(sent[0].ts <= now.getTime() + 2 * MINUTE);
  });

  it("does not wake for anything else", async () => {
    const { sent, client } = recorder();
    await wakePushIfNeeded({ importance: "more", delayUntil: null }, now, client);
    assert.equal(sent.length, 0);
  });

  it("does not wake for a notification held by quiet hours or a snooze", async () => {
    const { sent, client } = recorder();
    await wakePushIfNeeded({ importance: "important", delayUntil: new Date(now.getTime() + 60 * MINUTE) }, now, client);
    assert.equal(sent.length, 0);
  });
});
