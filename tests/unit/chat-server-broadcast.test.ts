import assert from "node:assert/strict";
import test from "node:test";

import { broadcast } from "@/lib/realtime/server-broadcast";

type Call = { url: string; init: RequestInit };

function fakeFetch(status: number, calls: Call[]) {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
}

const env = () => ({ url: "https://proj.supabase.co", serviceRoleKey: "service-key" });

test("posts one batched private broadcast to the Realtime REST API", async () => {
  const calls: Call[] = [];
  const ok = await broadcast(
    [
      { topic: "chat:channel:abc", event: "message.new", payload: { seq: 1 } },
      { topic: "chat:user:u1", event: "hint", payload: { channel_id: "abc", seq: 1 } },
    ],
    { fetch: fakeFetch(202, calls), env },
  );
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://proj.supabase.co/realtime/v1/api/broadcast");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.apikey, "service-key");
  assert.equal(headers.Authorization, "Bearer service-key");
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.messages.length, 2);
  assert.deepEqual(body.messages[0], { topic: "chat:channel:abc", event: "message.new", payload: { seq: 1 }, private: true });
});

test("an empty batch makes no request", async () => {
  const calls: Call[] = [];
  assert.equal(await broadcast([], { fetch: fakeFetch(202, calls), env }), true);
  assert.equal(calls.length, 0);
});

test("a failed publish is reported, never thrown (best-effort, L-1)", async () => {
  const calls: Call[] = [];
  assert.equal(await broadcast([{ topic: "t", event: "e", payload: {} }], { fetch: fakeFetch(500, calls), env }), false);
  const throwing = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  assert.equal(await broadcast([{ topic: "t", event: "e", payload: {} }], { fetch: throwing, env }), false);
});
