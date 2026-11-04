import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  assertUploadIntentBinding,
  classifyStorageVerificationError,
  storageAssetCanTransition,
} from "@/lib/upload/storage-asset-contract";

describe("storage asset lifecycle", () => {
  it("binds finalization to the issued bucket and key", () => {
    const intent = {
      bucket: "project-files",
      storageKey: "project/immutable-object",
    };

    assert.doesNotThrow(() => assertUploadIntentBinding(intent, {
      bucket: "project-files",
      storageKey: "project/immutable-object",
    }));
    assert.throws(
      () => assertUploadIntentBinding(intent, {
        bucket: "chat-attachments",
        storageKey: "project/immutable-object",
      }),
      /binding/i,
    );
    assert.throws(
      () => assertUploadIntentBinding(intent, {
        bucket: "project-files",
        storageKey: "project/replacement-object",
      }),
      /binding/i,
    );
  });

  it("does not revive assets after deletion starts", () => {
    assert.equal(storageAssetCanTransition("pending", "verified"), true);
    assert.equal(storageAssetCanTransition("verified", "delete_pending"), true);
    assert.equal(storageAssetCanTransition("delete_pending", "deleting"), true);
    assert.equal(storageAssetCanTransition("deleting", "deleted"), true);
    // Bytes are untouched until "deleting": a referenced pending deletion is restored (COR-045).
    assert.equal(storageAssetCanTransition("delete_pending", "verified"), true);
    assert.equal(storageAssetCanTransition("deleting", "verified"), false);
    assert.equal(storageAssetCanTransition("deleted", "pending"), false);
    assert.equal(storageAssetCanTransition("missing", "verified"), false);
  });

  it("keeps provider outages retryable while rejecting invalid content", () => {
    assert.equal(classifyStorageVerificationError({ status: 503 }), "retryable");
    assert.equal(classifyStorageVerificationError({ statusCode: 429 }), "retryable");
    assert.equal(classifyStorageVerificationError({ code: "ETIMEDOUT" }), "retryable");
    assert.equal(classifyStorageVerificationError({ status: 404 }), "terminal");
    assert.equal(classifyStorageVerificationError({ code: "CONTENT_MISMATCH" }), "terminal");
  });

  it("requires server decoding for published image purposes", () => {
    const source = readFileSync(new URL("../../src/lib/upload/upload-intents.ts", import.meta.url), "utf8");
    assert.match(source, /limitInputPixels: 16_000_000/);
    assert.match(source, /width \* height \* pages > 16_000_000/);
    assert.match(source, /intent\.scope === "profile_image"/);
    assert.match(source, /intent\.scope === "workspace_cover"/);
    assert.match(source, /intent\.scope === "workspace_update_media"/);
  });

  it("publishes profile images only through a sanitized public derivative", () => {
    const action = readFileSync(new URL("../../src/app/actions/profile.ts", import.meta.url), "utf8");
    const publisher = readFileSync(new URL("../../src/lib/profile/publish-profile-image.ts", import.meta.url), "utf8");
    const deletion = readFileSync(new URL("../../src/lib/storage/asset-deletion.ts", import.meta.url), "utf8");
    assert.match(action, /PROFILE_IMAGE_STAGING_BUCKET/);
    assert.match(action, /prepareVerifiedPublicProfileImage/);
    assert.doesNotMatch(action, /createSignedUploadUrl\(storagePath[\s\S]{0,120}avatars/);
    assert.match(publisher, /resize\(400, 400, \{ fit: "cover" \}\)/);
    assert.match(publisher, /cacheControl: "86400"/);
    assert.match(publisher, /sourceAssetId: source\.id/);
    assert.match(publisher, /quotaTracked: false/);
    assert.match(deletion, /inArray\(storageAssets\.state, \["pending", "verified"\]\)/);
  });

  it("does not hold deletions for a backup when backups are switched off", () => {
    const deletion = readFileSync(new URL("../../src/lib/storage/asset-deletion.ts", import.meta.url), "utf8");
    assert.match(deletion, /getS3BackupConfig\(\) \? undefined : eq\(storageAssets\.backupState, "pending"\)/);
  });
});
