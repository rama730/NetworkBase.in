import assert from "node:assert/strict";
import test from "node:test";

import { MEDIA_SIGNED_URL_SECONDS, SIGNED_URL_SECONDS, signedUrlSeconds } from "@/lib/messaging/attachment-ttl";
import { evictCachedTimelines } from "@/lib/messaging/storage-cache";

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

test("ITEM-03: eviction removes every cached timeline, not every other one", () => {
  const storage = memoryStorage({ nb_chat_cache_a: "1", nb_chat_cache_b: "2", nb_chat_cache_c: "3", nb_chat_cache_d: "4", other: "keep" });
  evictCachedTimelines(storage);
  assert.equal(storage.length, 1);
  assert.equal(storage.getItem("other"), "keep");
});

test("S3-06: video and audio links last through seeking; everything else stays short", () => {
  assert.equal(signedUrlSeconds("video/mp4"), MEDIA_SIGNED_URL_SECONDS);
  assert.equal(signedUrlSeconds("audio/mpeg"), MEDIA_SIGNED_URL_SECONDS);
  assert.equal(signedUrlSeconds("image/png"), SIGNED_URL_SECONDS);
  assert.equal(signedUrlSeconds(null), SIGNED_URL_SECONDS);
  // A player that outlasts the link reauthorizes through attachmentRetryUrl.
  assert.equal(MEDIA_SIGNED_URL_SECONDS, 30 * 60);
});

test("S3-04: signed resumable uploads go to the /sign endpoint", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
  const { resumableEndpoint } = await import("@/lib/upload/supabase-signed-upload-client");
  assert.equal(resumableEndpoint(), "https://abc.storage.supabase.co/storage/v1/upload/resumable/sign");
});
