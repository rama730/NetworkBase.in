import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("COR-004: every file revision carries its verified asset and the asset's digest", () => {
  const writer = read("src/lib/files/apply-file-revision.ts");
  assert.match(writer, /^\s+assetId: string \| null;/m, "assetId is required on the input");
  assert.match(writer, /eq\(storageAssets\.projectId, input\.projectId\)/);
  assert.match(writer, /eq\(storageAssets\.storageKey, input\.storageKey\)/);
  assert.match(writer, /contentHash = publishableAsset\.contentHash/);
  const versions = read("src/app/actions/files/versions.ts");
  assert.match(versions, /assetId: finalizedIntent\.assetId/);
  assert.match(versions, /assetId: source\.assetId \?\? null/);
  const bulk = read("src/app/api/v1/extension/bulk-finalize/route.ts");
  assert.match(bulk, /finalizeUploadIntent\(/);
  assert.match(bulk, /assetId: verifiedIntent\.assetId/);
  const runner = read("src/lib/github/sync-runner.ts");
  assert.match(runner, /assetId: await snapshotAssetId\(runId, file\.snapshotKey\)/);
  assert.equal((runner.match(/assetId: incomingAssetId/g) ?? []).length, 2);
});

test("COR-045: detached assets are retired only through the live-reference guard", () => {
  for (const path of [
    "src/app/actions/project/updates.ts",
    "src/lib/files/apply-file-revision.ts",
    "src/lib/github/sync-service.ts",
    "src/lib/files/permanent-delete.ts",
    "src/app/actions/files/versions.ts",
  ]) {
    const source = read(path);
    assert.match(source, /scheduleAssetDeletionIfUnreferenced\(/, path);
    assert.doesNotMatch(source, /state: "delete_pending"/, path);
  }
  assert.match(read("src/lib/storage/asset-deletion.ts"), /LIVE_REFERENCE_RESTORED/);
});
