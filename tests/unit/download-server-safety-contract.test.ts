import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const preview = read("src/app/api/v1/workspaces/[id]/files/[nodeId]/preview/route.ts");

test("no token opens a file without sign-in, access and verified checks", () => {
  assert.equal(existsSync("src/lib/files/preview-token.ts"), false);
  assert.doesNotMatch(preview, /PreviewHmacToken|searchParams\.get\("token"\)/);
});

test("a version that doesn't exist is not answered with the current file", () => {
  assert.match(preview, /revisionNumber === node\.currentVersion \? node : null/);
  assert.doesNotMatch(preview, /historical \?\? node/);
});

test("a chat upload link can't replace a file that was already verified", () => {
  const presign = read("src/app/api/v1/chat/attachments/presign/route.ts");
  assert.match(presign, /createSignedUploadUrl\(storagePath, \{ upsert: false \}\)/);
});

test("every byte path serves only verified assets", () => {
  const image = read("src/app/api/v1/workspaces/[id]/image/route.ts");
  assert.match(image, /if \(!asset\) return jsonError\("Not found", 404, "NOT_FOUND"\)/);
  assert.doesNotMatch(image, /\.info\(project\.key\)/);
  const extension = read("src/app/api/v1/extension/file/route.ts");
  assert.match(extension, /verifiedAsset/);
  assert.match(extension, /totalSize: verifiedAsset\.size/);
  const versions = read("src/app/actions/files/versions.ts");
  assert.match(versions.slice(versions.indexOf("export async function getFileVersionContentAction")), /state, "verified"/);
  const media = read("src/app/api/v1/workspaces/[id]/update-media/route.ts");
  assert.doesNotMatch(media, /legacyOwner/);
});
