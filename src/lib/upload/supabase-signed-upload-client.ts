"use client";

import { createClient } from "@/lib/supabase/client";

const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;
const RESUMABLE_CHUNK_BYTES = 6 * 1024 * 1024;
const TRANSFER_IDLE_TIMEOUT_MS = 30 * 1000;
const TRANSFER_MAX_DURATION_MS = 30 * 60 * 1000;
const MAX_RESUMABLE_TRANSFERS = 2;
const MAX_TRANSFERS = 4;

let activeResumableTransfers = 0;
const resumableWaiters: Array<() => void> = [];
let activeTransfers = 0;
const transferWaiters: Array<() => void> = [];

async function acquireTransferSlot(signal?: AbortSignal) {
  if (activeTransfers < MAX_TRANSFERS) {
    activeTransfers += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const index = transferWaiters.indexOf(onReady);
      if (index >= 0) transferWaiters.splice(index, 1);
      reject(new DOMException("Upload canceled", "AbortError"));
    };
    const onReady = () => {
      signal?.removeEventListener("abort", onAbort);
      activeTransfers += 1;
      resolve();
    };
    transferWaiters.push(onReady);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function releaseTransferSlot() {
  activeTransfers = Math.max(0, activeTransfers - 1);
  transferWaiters.shift()?.();
}

function cacheControlForProfile(profile: SignedUploadOptions["cacheProfile"]) {
  if (profile === "immutable") return "31536000";
  if (profile === "public") return "86400";
  return "3600";
}

type TusModule = typeof import("tus-js-client");
let loadTusClient = (): Promise<TusModule> => import("tus-js-client");
/** Test seam: replaces the resumable transport so cancellation races can be scripted. */
export function setTusClientLoaderForTests(loader: (() => Promise<TusModule>) | null) {
  loadTusClient = loader ?? (() => import("tus-js-client"));
}

async function acquireResumableSlot(signal?: AbortSignal) {
  if (activeResumableTransfers < MAX_RESUMABLE_TRANSFERS) {
    activeResumableTransfers += 1;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const index = resumableWaiters.indexOf(onReady);
      if (index >= 0) resumableWaiters.splice(index, 1);
      reject(new DOMException("Upload canceled", "AbortError"));
    };
    const onReady = () => {
      signal?.removeEventListener("abort", onAbort);
      activeResumableTransfers += 1;
      resolve();
    };
    resumableWaiters.push(onReady);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function releaseResumableSlot() {
  activeResumableTransfers = Math.max(0, activeResumableTransfers - 1);
  resumableWaiters.shift()?.();
}

export function resumableEndpoint() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) throw new Error("Supabase URL is unavailable");
  const url = new URL(rawUrl);
  if (url.hostname.endsWith(".supabase.co") && !url.hostname.endsWith(".storage.supabase.co")) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, ".storage.supabase.co");
  }
  // Signed uploads (x-signature) use the /sign variant; the bare path needs a user JWT.
  url.pathname = "/storage/v1/upload/resumable/sign";
  url.search = "";
  return url.toString();
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Upload canceled", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function uploadStandardOnce(
  session: SupabaseSignedUploadSession,
  file: Blob,
  options: SignedUploadOptions,
) {
  return new Promise<void>((resolve, reject) => {
    if (!session.uploadUrl) {
      reject(new Error("Signed upload URL is unavailable"));
      return;
    }
    const xhr = new XMLHttpRequest();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const maxTimer = setTimeout(() => xhr.abort(), TRANSFER_MAX_DURATION_MS);
    const cleanup = () => {
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(maxTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        xhr.abort();
        finish(new Error("Upload stalled for 30 seconds"));
      }, TRANSFER_IDLE_TIMEOUT_MS);
    };
    const onAbort = () => {
      xhr.abort();
      finish(new DOMException("Upload canceled", "AbortError"));
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    xhr.upload.addEventListener("progress", (event) => {
      resetIdle();
      options.onProgress?.(event.loaded, event.lengthComputable ? event.total : file.size);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) finish();
      else {
        const error = new Error(`Upload failed (${xhr.status})`) as Error & { status?: number };
        error.status = xhr.status;
        finish(error);
      }
    });
    xhr.addEventListener("error", () => finish(new Error("Upload network request failed")));
    xhr.addEventListener("abort", () => finish(new DOMException("Upload canceled", "AbortError")));
    xhr.open("PUT", session.uploadUrl);
    xhr.setRequestHeader("x-upsert", "false");
    const body = new FormData();
    body.append("cacheControl", cacheControlForProfile(options.cacheProfile));
    body.append("", file);
    resetIdle();
    xhr.send(body);
  });
}

async function uploadStandardWithRetries(
  session: SupabaseSignedUploadSession,
  file: Blob,
  options: SignedUploadOptions,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await uploadStandardOnce(session, file, options);
      return;
    } catch (error) {
      if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      lastError = error;
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
      // A previous attempt can commit while its response is lost. The server
      // finalizer verifies exact size, MIME and full digest before publication.
      if (status === 409 && attempt > 0) return;
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt === 3) throw error;
      await abortableDelay((2 ** attempt) * 300 + Math.floor(Math.random() * 250), options.signal);
    }
  }
  throw lastError;
}

export type SupabaseSignedUploadSession = {
  bucket: string;
  storagePath: string;
  uploadToken: string;
  contentType: string;
  uploadUrl?: string;
  accountScope?: string;
  operationId?: string;
};

export type SignedUploadOptions = {
  cacheProfile?: "revalidate" | "public" | "immutable";
  signal?: AbortSignal;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  onPhase?: (phase: "transferring" | "resuming" | "complete") => void;
};

export async function readSupabaseUploadOperation(operationId: string) {
  const response = await fetch(`/api/v1/uploads/${encodeURIComponent(operationId)}`, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Couldn’t read upload operation (${response.status})`);
  return response.json() as Promise<{
    success: true;
    data: {
      intentId: string;
      phase: "transfer_pending" | "verification_pending" | "verified" | "published" | "cancelled" | "failed";
      failureReason: string | null;
    };
  }>;
}

export async function cancelSupabaseUploadOperation(operationId: string) {
  const response = await fetch(`/api/v1/uploads/${encodeURIComponent(operationId)}`, {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin",
    keepalive: true,
  });
  if (!response.ok && response.status !== 409 && response.status !== 404) {
    throw new Error(`Couldn’t cancel upload operation (${response.status})`);
  }
}

async function uploadResumable(
  session: SupabaseSignedUploadSession,
  file: Blob,
  options: SignedUploadOptions,
) {
  await acquireResumableSlot(options.signal);
  try {
    const tus = await loadTusClient();
    await new Promise<void>((resolve, reject) => {
      // One settle point (API-017): once the attempt has finished or been cancelled, nothing the
      // transport, a timer or the resume lookup does afterwards may start, resume or report anything.
      let settled = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const stopTimers = () => {
        if (idleTimer) clearTimeout(idleTimer);
        clearTimeout(maxTimer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      // The slot is held until the transport has really stopped.
      const finish = async (outcome: { error?: unknown }, abortTransport: boolean) => {
        if (settled) return;
        settled = true;
        stopTimers();
        if (abortTransport) await upload.abort().catch(() => undefined);
        if (outcome.error !== undefined) reject(outcome.error);
        else resolve();
      };
      const maxTimer = setTimeout(() => {
        void finish({ error: new Error("Upload exceeded the 30 minute attempt limit") }, true);
      }, TRANSFER_MAX_DURATION_MS);
      const resetIdleTimer = () => {
        if (settled) return;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          void finish({ error: new Error("Upload stalled for 30 seconds") }, true);
        }, TRANSFER_IDLE_TIMEOUT_MS);
      };
      const onAbort = () => {
        void finish({ error: new DOMException("Upload canceled", "AbortError") }, true);
      };
      const fingerprintScope = session.accountScope || session.storagePath.split("/")[0] || "anonymous";
      const upload = new tus.Upload(file, {
        endpoint: resumableEndpoint(),
        chunkSize: RESUMABLE_CHUNK_BYTES,
        retryDelays: [0, 1_000, 3_000],
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        headers: {
          "x-signature": session.uploadToken,
          "x-upsert": "false",
        },
        metadata: {
          bucketName: session.bucket,
          objectName: session.storagePath,
          contentType: session.contentType,
          cacheControl: cacheControlForProfile(options.cacheProfile),
        },
        fingerprint: async () => [
          "nb-storage-v1",
          fingerprintScope,
          session.operationId || session.storagePath,
          file.size,
          session.contentType,
        ].join(":"),
        onProgress: (uploadedBytes, totalBytes) => {
          if (settled) return;
          resetIdleTimer();
          options.onProgress?.(uploadedBytes, totalBytes);
        },
        onError: (error) => {
          void finish({ error }, false);
        },
        onSuccess: () => {
          if (settled) return;
          options.onProgress?.(file.size, file.size);
          options.onPhase?.("complete");
          void finish({}, false);
        },
      });

      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      resetIdleTimer();
      void upload.findPreviousUploads().then((previousUploads) => {
        // The lookup is asynchronous: a cancellation (or timeout) that landed meanwhile must win.
        if (settled || options.signal?.aborted) return;
        if (previousUploads[0]) {
          options.onPhase?.("resuming");
          upload.resumeFromPreviousUpload(previousUploads[0]);
        } else {
          options.onPhase?.("transferring");
        }
        upload.start();
      }).catch((error) => {
        void finish({ error }, false);
      });
    });
  } finally {
    releaseResumableSlot();
  }
}

export async function uploadToSupabaseSignedUrl(
  session: SupabaseSignedUploadSession,
  file: Blob,
  options: SignedUploadOptions = {},
) {
  if (options.signal?.aborted) throw new DOMException("Upload canceled", "AbortError");
  await acquireTransferSlot(options.signal);
  try {
    if (file.size > RESUMABLE_THRESHOLD_BYTES) {
      await uploadResumable(session, file, options);
      return { path: session.storagePath, fullPath: `${session.bucket}/${session.storagePath}` };
    }

    options.onPhase?.("transferring");
    if (session.uploadUrl) {
      await uploadStandardWithRetries(session, file, options);
      options.onProgress?.(file.size, file.size);
      options.onPhase?.("complete");
      return { path: session.storagePath, fullPath: `${session.bucket}/${session.storagePath}` };
    }
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(session.bucket)
      .uploadToSignedUrl(session.storagePath, session.uploadToken, file, {
        cacheControl: cacheControlForProfile(options.cacheProfile),
        contentType: session.contentType,
      });
    if (options.signal?.aborted) throw new DOMException("Upload canceled", "AbortError");
    if (error) throw new Error(error.message || "Couldn’t upload file.");
    if (!data || (!data.path && !data.fullPath)) throw new Error("Upload succeeded with no data returned.");
    options.onProgress?.(file.size, file.size);
    options.onPhase?.("complete");
    return data;
  } catch (error) {
    const cancelled = options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError");
    if (cancelled && session.operationId) {
      await cancelSupabaseUploadOperation(session.operationId).catch(() => undefined);
    }
    throw error;
  } finally {
    releaseTransferSlot();
  }
}
