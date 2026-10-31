import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { RATE_LIMIT_ROUTE_POLICIES } from "../../src/lib/security/rate-limit";
import { signedUrlSeconds } from "../../src/lib/messaging/attachment-ttl";

const read = (path: string) => readFileSync(path, "utf8");
const preview = read("src/app/api/v1/workspaces/[id]/files/[nodeId]/preview/route.ts");
const chat = read("src/app/api/v1/chat/attachments/[assetId]/route.ts");
const shared = read("src/app/api/v1/_shared.ts");

test("every route that serves file bytes has a rate limit", () => {
  for (const [file, limit] of [
    ["src/app/api/v1/chat/attachments/[assetId]/route.ts", /enforceFileReadLimit\(request, "chat:attachments", 300, 60, user\.id\)/],
    ["src/app/api/v1/workspaces/[id]/image/route.ts", /enforceFileReadLimit\(request, "files:public-read", 300, 60, user\?\.id\)/],
    ["src/app/api/v1/workspaces/[id]/update-media/route.ts", /enforceFileReadLimit\(request, "files:public-read", 300, 60, user\?\.id\)/],
    ["src/app/api/v1/contribution-images/[id]/route.ts", /enforceFileReadLimit\(request, "files:public-read", 300, 60, user\?\.id\)/],
    ["src/app/api/v1/extension/file/route.ts", /enforceFileReadLimit\(request, "extension:file", 300, 60, user\.id\)/],
  ] as const) {
    assert.match(read(file), limit, file);
  }
  assert.match(preview, /enforceFileReadLimit\(request, "files:preview", 600, 60, user\?\.id\)/);
});

test("downloads share one budget, and the app's check runs out first so nothing saves an error", () => {
  assert.match(shared, /head \? "files:download-check" : "files:download", head \? 60 : 120, 60/);
  assert.match(chat, /enforceDownloadLimit\(request, user\.id\)/);
  assert.match(preview, /enforceDownloadLimit\(request, user\?\.id\)/);
});

test("a limiter outage keeps signed-in reads working and signed-out reads blocked", () => {
  assert.equal(RATE_LIMIT_ROUTE_POLICIES.signedInRead!.failMode, "allow");
  assert.match(shared, /userId \? "signedInRead" : "default"/);
  assert.equal(RATE_LIMIT_ROUTE_POLICIES.default!.failMode, undefined);
});

test("removed access applies at once on file views", () => {
  assert.doesNotMatch(preview, /stale-while-revalidate|max-age=3600|Access-Control-Allow-Origin|searchParams\.get\("redirect"\)/);
  assert.match(preview, /cacheControl: "private, no-cache"/);
  assert.equal(signedUrlSeconds("video/mp4"), 30 * 60);
  assert.equal(signedUrlSeconds("image/png"), 300);
  assert.equal(signedUrlSeconds(null), 300);
});
