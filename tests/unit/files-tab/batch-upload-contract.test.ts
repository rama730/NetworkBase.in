import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("2PC Batch Upload & Finalize Architecture Contract", () => {
  const mutationsPath = path.resolve(
    process.cwd(),
    "src/app/actions/files/mutations.ts",
  );
  const explorerMutationsPath = path.resolve(
    process.cwd(),
    "src/components/workspaces/v2/explorer/useExplorerMutations.ts",
  );

  it("mutations.ts exports finalizeBatchUpload with the canonical 50-file ceiling and publication invariants", () => {
    const source = readFileSync(mutationsPath, "utf-8");

    // Must export finalizeBatchUpload
    assert.match(source, /export async function finalizeBatchUpload\(/);

    // Keep one batch inside the shared server contract.
    assert.match(source, /if \(files\.length > 50\)/);

    // Must preload intents in a single batch query using inArray (not sequential findFirst loop)
    assert.match(source, /inArray\(uploadIntents\.id, intentIds\)/);
    assert.match(source, /inArray\(uploadIntents\.storageKey, storageKeys\)/);

    // Must execute within a single db.transaction
    assert.match(source, /await db\.transaction\(async \(tx\) =>/);

    // Must deduplicate files and insert in a single SQL operation
    assert.match(source, /await tx\.insert\(workspaceNodes\)\.values\(valuesToInsert\.map/);

    // Publication attaches verified assets and creates initial versions atomically.
    assert.match(source, /await tx\.insert\(fileVersions\)\.values/);
    assert.match(source, /eq\(storageAssets\.state, "verified"\)/);

    // Must return the optimistic attribution shape matching getWorkspaceNodes
    assert.match(source, /updatedById:\s*user\.id/);
    assert.match(source, /updatedByName:\s*profile\?\.fullName/);
    assert.match(source, /updatedByUsername:\s*profile\?\.username/);
    assert.match(source, /updatedByAvatarUrl:\s*profile\?\.avatarUrl/);
    assert.match(source, /versionUpdatedAt:\s*node\.updatedAt/);

    // Must verify destination parent is a folder
    assert.match(source, /parent\.type !== "folder"/);

    // Must scope sibling collision lookup by taskId and deletedAt
    assert.match(source, /isNull\(workspaceNodes\.taskId\)/);

  });

  it("useExplorerMutations.ts integrates finalizeBatchUpload for 2-round-trip uploads", () => {
    const source = readFileSync(explorerMutationsPath, "utf-8");

    // Must import finalizeBatchUpload
    assert.match(source, /finalizeBatchUpload/);

    // Must call finalizeBatchUpload after S3 direct upload finishes
    assert.match(source, /const batchNodes = await finalizeBatchUpload\(/);

    // Signing and publication stay in bounded windows.
    assert.match(source, /offset \+= 16/);
    assert.match(source, /offset \+= 50/);
    assert.match(source, /uploadToSupabaseSignedUrl/);
  });
});
