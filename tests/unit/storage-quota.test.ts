import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  assertStorageQuotaAdmission,
  MAX_OUTSTANDING_UPLOADS_PER_USER,
  PROJECT_STORAGE_LIMIT_BYTES,
  StorageQuotaError,
  USER_STORAGE_LIMIT_BYTES,
} from "../../src/lib/storage/storage-quota";

describe("storage quota admission", () => {
  it("defines the agreed personal and project limits", () => {
    assert.equal(USER_STORAGE_LIMIT_BYTES, 1024 ** 3);
    assert.equal(PROJECT_STORAGE_LIMIT_BYTES, 10 * 1024 ** 3);
  });

  it("reconciliation preserves reservations until physical deletion", () => {
    const source = readFileSync(new URL("../../scripts/db/repair/reconcile-storage-quotas.ts", import.meta.url), "utf8");
    assert.match(source, /IN \('pending', 'delete_pending', 'deleting'\).*verifiedSize\} IS NULL/);
    assert.match(source, /SELECT scope_id AS id FROM public\.storage_quota_scopes/);
    assert.match(source, /UNION/);
    assert.match(source, /storageAssets\.quotaTracked/);
  });

  it("allows a reservation that exactly fills the remaining quota", () => {
    const result = assertStorageQuotaAdmission({
      limitBytes: 100,
      retainedBytes: 50,
      reservedBytes: 25,
      outstandingUploads: 2,
      incomingBytes: 25,
    });
    assert.deepEqual(result, { availableBytes: 25, remainingAfterReservation: 0 });
  });

  it("rejects new bytes while preserving existing over-quota reads", () => {
    assert.throws(() => assertStorageQuotaAdmission({
      limitBytes: 100,
      retainedBytes: 110,
      reservedBytes: 0,
      outstandingUploads: 0,
      incomingBytes: 1,
    }), (error) => error instanceof StorageQuotaError
      && error.code === "STORAGE_QUOTA_EXCEEDED"
      && error.availableBytes === 0);
  });

  it("rejects the sixty-fifth outstanding upload", () => {
    assert.throws(() => assertStorageQuotaAdmission({
      limitBytes: 100,
      retainedBytes: 0,
      reservedBytes: 0,
      outstandingUploads: MAX_OUTSTANDING_UPLOADS_PER_USER,
      incomingBytes: 1,
    }), (error) => error instanceof StorageQuotaError
      && error.code === "OUTSTANDING_UPLOAD_LIMIT");
  });
});
