import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { allocateProjectObjectKey } from "@/lib/upload/project-upload-allocation";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("project upload publication", () => {
  it("allocates an immutable server object key without retaining the logical path", () => {
    const allocated = allocateProjectObjectKey(
      PROJECT_ID,
      `${PROJECT_ID}/private/customer/report.pdf`,
      "application/pdf",
      () => "22222222-2222-4222-8222-222222222222",
    );

    assert.equal(
      allocated,
      `${PROJECT_ID}/uploads/22222222-2222-4222-8222-222222222222.pdf`,
    );
    assert.doesNotMatch(allocated, /customer|report/);
  });

  it("rejects allocation across project scopes", () => {
    assert.throws(
      () => allocateProjectObjectKey(
        PROJECT_ID,
        "33333333-3333-4333-8333-333333333333/file.txt",
        "text/plain",
      ),
      /workspace does not match/i,
    );
  });

  it("publishes ordinary and folder uploads with assets and initial versions", () => {
    const mutations = readFileSync(
      new URL("../../src/app/actions/files/mutations.ts", import.meta.url),
      "utf8",
    );
    const folderRegistration = readFileSync(
      new URL("../../src/app/actions/upload-import.ts", import.meta.url),
      "utf8",
    );

    assert.match(mutations, /assetId,\s*size: normalizedSize/);
    assert.match(mutations, /tx\.insert\(fileVersions\)/);
    assert.match(folderRegistration, /uploadIntentId: string/);
    assert.match(folderRegistration, /storageKey: string/);
    assert.match(folderRegistration, /tx\.insert\(fileVersions\)/);
    assert.doesNotMatch(folderRegistration, /buildProjectFileKey\(projectId, entry\.relativePath\)/);
  });

  it("does not create visible file placeholders before folder bytes are verified", () => {
    const mutations = readFileSync(
      new URL("../../src/app/actions/files/mutations.ts", import.meta.url),
      "utf8",
    );
    const bulkTreeBody = mutations.slice(
      mutations.indexOf("export async function bulkCreateFolderTree"),
      mutations.indexOf("export async function getOrCreateTaskSystemFolderAction"),
    );

    assert.match(bulkTreeBody, /Return publication targets only/);
    assert.doesNotMatch(bulkTreeBody, /type:\s*['"]file['"]/);
  });

  it("exposes authoritative operation status and cancellation without object keys", () => {
    const intents = readFileSync(
      new URL("../../src/lib/upload/upload-intents.ts", import.meta.url),
      "utf8",
    );
    const route = readFileSync(
      new URL("../../src/app/api/v1/uploads/[intentId]/route.ts", import.meta.url),
      "utf8",
    );

    assert.match(intents, /phase: row\.status === "finalized" && published[\s\S]*\? "published"/);
    assert.match(intents, /Upload canceled by user/);
    assert.match(route, /readUploadOperationStatus/);
    assert.match(route, /cancelUploadOperation/);
    assert.doesNotMatch(route, /storageKey/);
  });

  it("pages retained versions with a stable descending cursor", () => {
    const versions = readFileSync(
      new URL("../../src/app/actions/files/versions.ts", import.meta.url),
      "utf8",
    );
    const hook = readFileSync(
      new URL("../../src/hooks/useFileVersions.ts", import.meta.url),
      "utf8",
    );

    assert.match(versions, /beforeVersion == null \? undefined : lt\(fileVersions\.version, beforeVersion\)/);
    assert.match(versions, /orderBy\(desc\(fileVersions\.version\)\)/);
    assert.match(versions, /limit\(requestedLimit \+ 1\)/);
    assert.match(hook, /loadMoreVersions/);
    assert.match(hook, /beforeVersion: nextCursor/);
  });
});
