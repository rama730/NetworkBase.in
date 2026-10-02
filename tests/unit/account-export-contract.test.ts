import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeAccountExportMessage } from "@/lib/account/export-contract";

const base = {
  id: "message-id",
  conversationId: "conversation-id",
  content: "private message content",
  type: "text",
  createdAt: new Date("2026-09-30T00:00:00.000Z"),
};

test("account export preserves the account holder's sent content", () => {
  const result = sanitizeAccountExportMessage({ ...base, senderId: "self" }, "self");
  assert.equal(result.content, base.content);
  assert.equal(result.direction, "sent");
  assert.equal(result.redacted, false);
});

test("account export redacts another participant's identity and content", () => {
  const result = sanitizeAccountExportMessage({ ...base, senderId: "other-user" }, "self");
  assert.equal(result.content, null);
  assert.equal(result.direction, "received");
  assert.equal(result.sender, "other-redacted");
  assert.equal(result.redacted, true);
  assert.equal("senderId" in result, false);
});

test("account export retains system message content without a sender identity", () => {
  const result = sanitizeAccountExportMessage({ ...base, senderId: null }, "self");
  assert.equal(result.content, base.content);
  assert.equal(result.sender, "system");
  assert.equal(result.redacted, false);
});
