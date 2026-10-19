import assert from "node:assert/strict";
import { test } from "node:test";

// A scripted tus client: findPreviousUploads resolves on demand, so a cancel can land during the lookup.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
const events: string[] = [];
let releaseLookup: (() => void) | null = null;
class FakeUpload {
  constructor(readonly file: Blob, readonly opts: Record<string, unknown>) {}
  findPreviousUploads() {
    events.push("lookup");
    return new Promise<unknown[]>((resolve) => { releaseLookup = () => resolve([]); });
  }
  resumeFromPreviousUpload() { events.push("resume"); }
  start() { events.push("start"); }
  async abort() { events.push("abort"); }
}
const session = { bucket: "b", storagePath: "acct/file.bin", uploadToken: "t", contentType: "application/octet-stream", operationId: "op1", accountScope: "acct" } as never;
const big = new Blob([new Uint8Array(7 * 1024 * 1024)]);

// API-017: a cancel that lands during the asynchronous resume lookup must stop the upload from ever starting.
test("cancelling during the resume lookup never starts or resumes the upload and frees the slot", async () => {
  const { uploadToSupabaseSignedUrl, setTusClientLoaderForTests } = await import("../../src/lib/upload/supabase-signed-upload-client");
  setTusClientLoaderForTests(async () => ({ Upload: FakeUpload }) as never);
  const controller = new AbortController();
  events.length = 0;
  const pending = uploadToSupabaseSignedUrl(session, big, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(events, ["lookup"]);

  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  releaseLookup?.(); // the lookup finishes after the cancellation
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(!events.includes("start") && !events.includes("resume"), `events: ${events.join(",")}`);
  assert.ok(events.includes("abort"), "the transport is aborted before the attempt settles");

  // The slot was released: two more resumable uploads can still acquire theirs.
  const second = new AbortController();
  const third = new AbortController();
  events.length = 0;
  const a = uploadToSupabaseSignedUrl(session, big, { signal: second.signal });
  const b = uploadToSupabaseSignedUrl(session, big, { signal: third.signal });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(events.filter((event) => event === "lookup").length, 2);
  second.abort(); third.abort();
  await Promise.allSettled([a, b]);
});
