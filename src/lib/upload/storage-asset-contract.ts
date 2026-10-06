export const STORAGE_ASSET_STATES = [
  "pending",
  "verified",
  "delete_pending",
  "deleting",
  "deleted",
  "missing",
] as const;

export type StorageAssetState = (typeof STORAGE_ASSET_STATES)[number];

const TRANSITIONS: Readonly<Record<StorageAssetState, readonly StorageAssetState[]>> = {
  pending: ["verified", "delete_pending", "missing"],
  verified: ["delete_pending", "missing"],
  // A still-referenced pending deletion is restored, never deleted (COR-045).
  delete_pending: ["deleting", "verified"],
  deleting: ["deleted", "delete_pending"],
  deleted: [],
  missing: ["delete_pending"],
};

export function storageAssetCanTransition(from: StorageAssetState, to: StorageAssetState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertUploadIntentBinding(
  intent: { bucket: string; storageKey: string },
  requested: { bucket: string; storageKey: string },
): void {
  if (intent.bucket !== requested.bucket || intent.storageKey !== requested.storageKey) {
    throw new Error("Upload intent binding does not match the issued object");
  }
}

type StorageErrorLike = {
  status?: number | null;
  statusCode?: number | null;
  code?: string | null;
};

const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ABORT_ERR",
  "PROVIDER_UNAVAILABLE",
  "VERIFICATION_IN_PROGRESS",
]);

export function classifyStorageVerificationError(error: StorageErrorLike | null | undefined): "retryable" | "terminal" {
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "retryable";
  if (error?.code && RETRYABLE_CODES.has(error.code.toUpperCase())) return "retryable";
  return "terminal";
}
