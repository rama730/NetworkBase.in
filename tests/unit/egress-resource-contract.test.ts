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
  assert.match(read("src/app/api/v1/workspaces/[id]/image/route.ts"), /private, max-age=300, must-revalidate/);
  assert.match(read("src/app/api/v1/workspaces/[id]/update-media/route.ts"), /private, max-age=300, must-revalidate/);
  assert.match(read("src/app/api/v1/contribution-images/[id]/route.ts"), /private, max-age=300, must-revalidate/);
});

test("app chrome renders before the legal gate and profile pages reuse server reads", () => {
  const layout = read("src/app/(site)/(main)/layout.tsx");
  // Live-fix problem 2: name and photo come from the light identity read, never the full profile.
  assert.match(layout, /getViewerIdentityContext/);
  assert.match(layout, /initialProfile=\{initialProfile\}/);
  assert.doesNotMatch(layout, /getViewerProfileContext/);
  assert.match(layout, /<MainLayout>\s*<Suspense[\s\S]*<LegalAcceptanceGate user=\{user\}>\{children\}<\/LegalAcceptanceGate>/);
  assert.match(read("src/app/(site)/(main)/u/[username]/page.tsx"), /const readPublicProfileRoute = cache/);
  assert.match(read("src/app/(site)/(main)/my-profile/page.tsx"), /const readOwnerProfileRoute = cache/);
});

test("avatar and onboarding writes use the shared optimized lifecycle", () => {
  const editor = read("src/components/profile/edit/DetailsSection.tsx");
  assert.match(editor, /compressAvatarOffMainThread/);
  assert.match(editor, /cacheProfile: 'public'/);
  assert.match(editor, /publicAvatarVariantUrl\(avatar, 128\)/);

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

test("workspace file preview redirects non-PDF GET requests to short-lived signed URLs and short-circuits 304 and HEAD before storage signing", () => {
  const preview = read("src/app/api/v1/workspaces/[id]/files/[nodeId]/preview/route.ts");
  assert.match(preview, /request\.headers\.get\("if-none-match"\) === etag/);
  assert.match(preview, /const safetyMarginMs = Math\.min\(300_000, Math\.floor\(ttlSeconds \* 200\)\)/);
  assert.match(preview, /if \(request\.method === "HEAD"\)/);
  assert.match(preview, /!isPdf && request\.method !== "HEAD"/);
  assert.match(preview, /status: 302/);
  assert.match(preview, /signedUrlSeconds\(asset\.mimeType\)/);
  assert.match(preview, /streamPrivateObject/);

  const contentAction = read("src/app/actions/files/content.ts");
  assert.match(contentAction, /\?v=\$\{encodeURIComponent\(String\(node\.currentVersion \?\? 1\)\)\}/);

  for (const path of [
    "src/app/api/v1/workspaces/[id]/image/route.ts",
    "src/app/api/v1/workspaces/[id]/update-media/route.ts",
    "src/app/api/v1/contribution-images/[id]/route.ts",
    "src/app/api/v1/extension/file/route.ts",
  ]) {
    const source = read(path);
    const etagCheckIndex = source.indexOf('request.headers.get("if-none-match") === etag');
    const signIndex = source.indexOf("createSignedUrl(");
    assert.ok(etagCheckIndex > 0 && signIndex > etagCheckIndex, `${path} must check If-None-Match before calling createSignedUrl`);
  }
});

test("preview drivers avoid duplicate downloads via lazy SVG source fetch and bounded LRU caches", () => {
  const mediaDriver = read("src/components/workspaces/v2/preview/drivers/MediaViewerDriver.tsx");
  assert.doesNotMatch(mediaDriver, /bytes=0-1048576/);
  assert.match(mediaDriver, /preload="metadata"/);

  const imageDriver = read("src/components/workspaces/v2/preview/drivers/ImageViewerDriver.tsx");
  assert.match(imageDriver, /if \(!isSvg \|\| viewMode !== "code" \|\| !fileUrl\) return/);
  assert.match(imageDriver, /getCachedSvgSource/);

  const presentationDriver = read("src/components/workspaces/v2/preview/drivers/PresentationViewerDriver.tsx");
  assert.match(presentationDriver, /presentationBufferCache/);
  assert.match(presentationDriver, /getCachedPresentationBuffer/);

  const docxDriver = read("src/components/workspaces/v2/preview/drivers/DocxViewerDriver.tsx");
  assert.match(docxDriver, /docxBufferCache/);
  assert.match(docxDriver, /getCachedDocxBuffer/);

  const sheetDriver = read("src/components/workspaces/v2/preview/drivers/SheetViewerDriver.tsx");
  assert.match(sheetDriver, /sheetPreviewCache/);
  assert.match(sheetDriver, /getCachedSheetPreview/);

  const archiveDriver = read("src/components/workspaces/v2/preview/drivers/ArchiveViewerDriver.tsx");
  assert.match(archiveDriver, /archivePreviewCache/);
  assert.match(archiveDriver, /getCachedArchivePreview/);

  const binaryDriver = read("src/components/workspaces/v2/preview/drivers/BinaryInspectorDriver.tsx");
  assert.match(binaryDriver, /binaryHexCache/);
  assert.match(binaryDriver, /getCachedBinaryHex/);
});

test("socket entrypoint and proxy short-circuit scanner probes with 0-byte 404 and skip anonymous Supabase client instantiation", () => {
  const startProd = read("scripts/start-production.cjs");
  assert.match(startProd, /isScannerProbePath\(pathname\)/);
  assert.match(startProd, /"content-length": "0"/);

  const proxy = read("src/proxy.ts");
  assert.match(proxy, /isScannerProbePath\(request\.nextUrl\.pathname\)/);
  assert.match(proxy, /new Response\(null, \{\s*status: 404/);
  assert.match(proxy, /!isPrefetch && request\.method !== "HEAD"/);

  const middleware = read("src/lib/supabase/middleware.ts");
  const branchIndex = middleware.indexOf("if (shouldResolveAuth)");
  const clientIndex = middleware.indexOf("createServerClient(");
  assert.ok(branchIndex > 0 && clientIndex > branchIndex, "createServerClient must only run when auth cookies exist");
});

test("Sentry disables 60-second idle client_report flushes and runtime channel injection", () => {
  const options = read("src/lib/observability/sentry-options.ts");
  assert.match(options, /sendClientReports:\s*false/);

  const instrumentation = read("src/instrumentation.ts");
  assert.match(instrumentation, /enableOpenTelemetrySetup:\s*false/);
  assert.match(instrumentation, /enableRuntimeChannelInjection:\s*false/);
});

test("database pooler defaults to Supavisor Session mode (:5432) with prepared statements", () => {
  const db = read("src/lib/db/index.ts");
  assert.match(db, /resolveConnectionString/);
  assert.match(db, /url\.port = '5432'/);
  assert.match(db, /const prepare = !usesTransactionPooler\(connectionString\)/);
  assert.match(db, /prepare: true/);
});

