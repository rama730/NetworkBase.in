import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { isAllowedPushEndpoint } from "../../src/lib/notifications/push-endpoint";

// COR-017: only real push providers are ever called.
test("real push-service endpoints are accepted", () => {
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/abc:def",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
    "https://web.push.apple.com/QGxyz",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
    "https://android.googleapis.com/gcm/send/abc",
  ]) assert.equal(isAllowedPushEndpoint(endpoint), true, endpoint);
});

test("arbitrary, private or confusable destinations are refused", () => {
  for (const endpoint of [
    "https://example.com/push",
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/push",
    "https://fcm.googleapis.com.evil.example/fcm/send/abc",
    "https://evilfcm.googleapis.com.example.org/x",
    "https://notfcm.googleapis.com@evil.example/x",
    "https://user:pw@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://[::1]/x",
    "not a url",
    "",
    null,
    42,
  ]) assert.equal(isAllowedPushEndpoint(endpoint), false, String(endpoint));
});

test("the save action and the send path both enforce the allowlist", () => {
  assert.match(readFileSync("src/app/actions/push-subscriptions.ts", "utf8"), /isAllowedPushEndpoint\(input\?\.endpoint\)/);
  const send = readFileSync("src/lib/notifications/web-push.ts", "utf8");
  assert.match(send, /allowedRows\.map\(async \(row\)/);
  assert.match(send, /web_push_endpoint_refused/);
});
