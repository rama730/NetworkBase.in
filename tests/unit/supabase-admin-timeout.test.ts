import assert from "node:assert/strict";
import test from "node:test";

test("admin recipient lookups abort a stalled Auth request and allow subsequent lookups", { timeout: 1_000 }, async (t) => {
  const originalEnv = { ...process.env };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth.example.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-key";
  const controller = new AbortController();
  let observed!: () => void;
  const started = new Promise<void>((resolve) => { observed = resolve; });
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 8_000);
    return controller.signal;
  });
  t.mock.method(console, "error", () => undefined);
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.match(String(input), /^https:\/\/auth\.example\.test\/auth\/v1\/admin\/users\//);
    assert.equal(init?.signal, controller.signal);
    observed();
    return new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    });
  });
  try {
    const { createAdminClient } = await import("@/lib/supabase/server");
    const admin = await createAdminClient();
    const pending = admin.auth.admin.getUserById("00000000-0000-4000-8000-000000000001");
    await started;
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    const result = await pending;
    assert.ok(result.error);
    assert.equal(result.data.user, null);

    const nextController = new AbortController();
    t.mock.method(AbortSignal, "timeout", () => nextController.signal);
    t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(init?.signal, nextController.signal);
      return Response.json({ id: "00000000-0000-4000-8000-000000000002", email: "fixture@example.test" });
    });
    const next = await admin.auth.admin.getUserById("00000000-0000-4000-8000-000000000002");
    assert.equal(next.error, null);
    assert.equal(next.data.user?.id, "00000000-0000-4000-8000-000000000002");
  } finally {
    process.env = originalEnv;
  }
});
