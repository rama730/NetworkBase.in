import assert from "node:assert/strict";
import test from "node:test";

import { buildTestEmail, TEST_PUSH } from "@/lib/notifications/test-send";

test("the test email goes only to the person, says it is a test, and links back to Settings", () => {
  const email = buildTestEmail({ userId: "u1", email: "ada@example.com", name: "Ada Lovelace", username: "ada", avatarUrl: null });
  assert.deepEqual(email.to, ["ada@example.com"]);
  assert.match(email.subject, /test/i);
  assert.match(email.text, /settings#settings-notifications-delivery/);
  assert.match(email.html, /Ada Lovelace/);
  assert.doesNotMatch(email.html, /<script/i);
});

test("the test push says what it is and opens notification settings", () => {
  assert.match(TEST_PUSH.title, /test/i);
  assert.equal(TEST_PUSH.href, "/settings#settings-notifications-delivery");
});
