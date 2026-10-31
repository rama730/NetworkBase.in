import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("stable project media routes use the shared conditional streaming owner", () => {
  const helper = read("src/lib/storage/private-object-response.ts");
  assert.match(helper, /if-none-match/);
  assert.match(helper, /ETag/);
  assert.match(helper, /private, no-store/);
  for (const path of [
    "src/app/api/v1/workspaces/[id]/image/route.ts",
    "src/app/api/v1/workspaces/[id]/update-media/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /streamPrivateObject/);
    assert.match(source, /etag(?:,|:)/);
  }
  assert.match(read("src/app/api/v1/workspaces/[id]/image/route.ts"), /private, no-store/);
  assert.match(read("src/app/api/v1/workspaces/[id]/update-media/route.ts"), /private, no-store/);
});

test("app chrome renders before the legal gate and profile pages reuse server reads", () => {
  const layout = read("src/app/(site)/(main)/layout.tsx");
  assert.match(layout, /initialProfile=\{null\}/);
  assert.doesNotMatch(layout, /getViewerProfileContext/);
  assert.match(layout, /<MainLayout>\s*<Suspense[\s\S]*<LegalAcceptanceGate user=\{user\}>\{children\}<\/LegalAcceptanceGate>/);
  assert.match(read("src/app/(site)/(main)/u/[username]/page.tsx"), /const readPublicProfileRoute = cache/);
  assert.match(read("src/app/(site)/(main)/my-profile/page.tsx"), /const readOwnerProfileRoute = cache/);
});

test("avatar and onboarding writes use the shared optimized lifecycle", () => {
  const editor = read("src/components/profile/edit/EditProfileTabs.tsx");
  assert.match(editor, /compressAvatarOffMainThread/);
  assert.match(editor, /cacheProfile: "public"/);
  assert.match(editor, /publicAvatarVariantUrl\(avatarSrc, 128\)/);

  const onboarding = read("src/app/(site)/(onboarding)/onboarding/page.tsx");
  assert.doesNotMatch(onboarding, /saveOnboardingDraft/);
  assert.doesNotMatch(onboarding, /trackOnboardingEvent/);
  assert.match(onboarding, /telemetry: events/);
  assert.match(onboarding, /compressAvatarOffMainThread/);
  assert.match(onboarding, /cacheProfile: 'public'/);
});

test("visibility-mutable project media stays inside the revocation cache budget", () => {
  for (const path of [
    "src/app/api/v1/workspaces/[id]/image/route.ts",
    "src/app/api/v1/workspaces/[id]/update-media/route.ts",
  ]) {
    const source = read(path);
    assert.match(source, /max-age=300, s-maxage=300, must-revalidate/);
    assert.doesNotMatch(source, /max-age=86400/);
  }
});

test("chat attachments use canonical direct uploads and short-lived member-checked links", () => {
  const presign = read("src/app/api/v1/chat/attachments/presign/route.ts");
  const route = read("src/app/api/v1/chat/attachments/[assetId]/route.ts");
  assert.match(presign, /createUploadIntent/);
  assert.match(presign, /finalizeUploadIntent/);
  assert.match(route, /app_private\.chat_is_member/);
  // Short-lived: 5 minutes, or 30 for audio/video so seeking keeps working (S3-06).
  assert.match(route, /const seconds = signedUrlSeconds\(row\.mime\)[\s\S]*createSignedUrl\(storageKey, seconds\)/);
  assert.match(read("src/lib/messaging/attachment-ttl.ts"), /SIGNED_URL_SECONDS = 300[\s\S]*MEDIA_SIGNED_URL_SECONDS = 30 \* 60[\s\S]*\^\(video\|audio\)/);
});

test("missing message media exposes a terminal unavailable state", () => {
  const attachments = read("src/components/messages/parts/message-attachments.tsx");
  assert.match(attachments, /Media unavailable/);
  assert.doesNotMatch(attachments, /Download media/);
});

test("PDF preview reuses the stable attachment route instead of cloning a full blob", () => {
  const attachments = read("src/components/messages/parts/message-attachments.tsx");
  assert.match(attachments, /src=\{sourceUrl\}/);
  assert.doesNotMatch(attachments, /const loadPdf|res\.blob\(\)|URL\.createObjectURL\(new Blob/);
});

test("project PDF preview streams the authorized route without cloning a browser blob", () => {
  const preview = read("src/components/workspaces/v2/preview/AssetPreview.tsx");
  assert.match(preview, /src=\{previewUrl\}/);
  assert.doesNotMatch(preview, /response\.blob\(\)|URL\.createObjectURL\(new Blob/);
});

test("file recovery uses an immutable bounded Git blob identity", () => {
  const content = read("src/lib/files/content-reader.ts");
  assert.match(content, /tryRecoverFromGitHub\(projectId, node\.gitHash\)/);
  assert.match(content, /\/git\/blobs\/\$\{encodeURIComponent\(gitBlobSha\)\}/);
  assert.match(content, /MAX_GITHUB_BLOB_RESPONSE_BYTES/);
  assert.doesNotMatch(content, /\/contents\/\$\{encodeURIComponent\(cleanPath\)\}/);
});
