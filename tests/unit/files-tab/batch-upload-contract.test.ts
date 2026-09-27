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
    "src/components/projects/v2/explorer/useExplorerMutations.ts",
  );

  it("mutations.ts exports finalizeBatchUpload with 100-file ceiling and 2PC batch invariants", () => {
    const source = readFileSync(mutationsPath, "utf-8");

    // Must export finalizeBatchUpload
    assert.match(source, /export async function finalizeBatchUpload\(/);

    // Must enforce batch limit of 100 files
    assert.match(source, /if \(files\.length > 100\)/);

    // Must preload intents in a single batch query using inArray (not sequential findFirst loop)
    assert.match(source, /inArray\(uploadIntents\.id, intentIds\)/);
    assert.match(source, /inArray\(uploadIntents\.storageKey, storageKeys\)/);

    // Must execute within a single db.transaction
    assert.match(source, /await db\.transaction\(async \(tx\) =>/);

    // Must deduplicate files and insert in a single SQL operation
    assert.match(source, /await tx\.insert\(projectNodes\)\.values\(valuesToInsert\)\.returning\(\)/);

    // Must batch-record node events rather than firing individual sequential DB calls
    assert.match(source, /recordNodeEventsBatch\(/);

    // Must return the optimistic attribution shape matching getProjectNodes
    assert.match(source, /updatedById:\s*user\.id/);
    assert.match(source, /updatedByName:\s*profile\?\.fullName/);
    assert.match(source, /updatedByUsername:\s*profile\?\.username/);
    assert.match(source, /updatedByAvatarUrl:\s*profile\?\.avatarUrl/);
    assert.match(source, /versionUpdatedAt:\s*node\.updatedAt/);

    // Must verify destination parent is a folder
    assert.match(source, /parent\.type !== "folder"/);

    // Must scope sibling collision lookup by taskId and deletedAt
    assert.match(source, /isNull\(projectNodes\.taskId\)/);

    // Must await batch record node events
    assert.match(source, /await recordNodeEventsBatch\(/);
  });

  it("useExplorerMutations.ts integrates finalizeBatchUpload for 2-round-trip uploads", () => {
    const source = readFileSync(explorerMutationsPath, "utf-8");

    // Must import finalizeBatchUpload
    assert.match(source, /finalizeBatchUpload/);

    // Must call finalizeBatchUpload after S3 direct upload finishes
    assert.match(source, /const batchNodes = await finalizeBatchUpload\(/);

    // Must have a fallback loop for resilience if batch call fails
    assert.match(source, /createFileNode\(projectId, parentId,/);
  });
});
