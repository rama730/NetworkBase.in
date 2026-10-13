import "server-only";

import { reportedContentLength } from "@/lib/http/content-length";
import { createAdminClient } from "@/lib/supabase/server";

export async function readBoundedStorageBytes(input: {
  bucket: string;
  storageKey: string;
  maxBytes: number;
  timeoutMs?: number;
}) {
  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(input.bucket).createSignedUrl(input.storageKey, 60);
  if (error || !data?.signedUrl) throw error ?? new Error("Unable to authorize storage read");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 10_000);
  try {
    const response = await fetch(data.signedUrl, { cache: "no-store", signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`Storage read failed (${response.status})`);
    const reportedLength = reportedContentLength(response.headers);
    if (reportedLength !== null && reportedLength > input.maxBytes) {
      throw new Error("Stored object exceeds the inline read limit");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > input.maxBytes) {
          await reader.cancel("Inline read limit exceeded");
          throw new Error("Stored object exceeds the inline read limit");
        }
        chunks.push(value);
      }
      const output = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return output;
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function readBoundedStorageText(input: {
  bucket: string;
  storageKey: string;
  maxBytes: number;
  timeoutMs?: number;
}) {
  const bytes = await readBoundedStorageBytes(input);
  return new TextDecoder().decode(bytes);
}
