export const MAX_OUTSTANDING_UPLOADS_PER_USER = 64;
export const USER_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;
export const WORKSPACE_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

export class StorageQuotaError extends Error {
  readonly code: "OUTSTANDING_UPLOAD_LIMIT" | "STORAGE_QUOTA_EXCEEDED";
  readonly availableBytes: number;

  constructor(
    message: string,
    code: StorageQuotaError["code"],
    availableBytes: number,
  ) {
    super(message);
    this.name = "StorageQuotaError";
    this.code = code;
    this.availableBytes = availableBytes;
  }
}

export function assertStorageQuotaAdmission(input: {
  limitBytes: number;
  retainedBytes: number;
  reservedBytes: number;
  outstandingUploads: number;
  incomingBytes: number;
}) {
  if (input.outstandingUploads >= MAX_OUTSTANDING_UPLOADS_PER_USER) {
    throw new StorageQuotaError(
      `Too many outstanding uploads. Maximum ${MAX_OUTSTANDING_UPLOADS_PER_USER}.`,
      "OUTSTANDING_UPLOAD_LIMIT",
      Math.max(0, input.limitBytes - input.retainedBytes - input.reservedBytes),
    );
  }
  const availableBytes = Math.max(0, input.limitBytes - input.retainedBytes - input.reservedBytes);
  if (input.incomingBytes > availableBytes) {
    throw new StorageQuotaError(
      `Storage quota exceeded. ${availableBytes} bytes remain.`,
      "STORAGE_QUOTA_EXCEEDED",
      availableBytes,
    );
  }
  return { availableBytes, remainingAfterReservation: availableBytes - input.incomingBytes };
}
