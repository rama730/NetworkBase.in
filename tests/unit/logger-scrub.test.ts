import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { logger, scrubMessage } from "@/lib/logger";

const saved = { env: process.env.NODE_ENV, stacks: process.env.LOG_ERROR_STACKS };
afterEach(() => {
  Reflect.set(process.env, "NODE_ENV", saved.env);
  if (saved.stacks === undefined) delete process.env.LOG_ERROR_STACKS; else process.env.LOG_ERROR_STACKS = saved.stacks;
});

function capture(fn: () => void) {
  const original = console.error;
  const seen: Array<Record<string, unknown>> = [];
  console.error = (_tag: unknown, entry: Record<string, unknown>) => { seen.push(entry); };
  try { fn(); } finally { console.error = original; }
  return seen[0]!;
}

// SEC-011: messages and stacks are not safe just because they are errors.
test("known secret formats are scrubbed from messages", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk";
  assert.equal(scrubMessage(`bad ${jwt}`), "bad [JWT]");
  assert.equal(scrubMessage("sent Bearer abc123def456ghi"), "sent Bearer [REDACTED]");
  assert.equal(scrubMessage("GET https://u:p@db.test/x?token=abc&y=1 failed"), "GET https://[REDACTED]@db.test/x?[REDACTED] failed");
  assert.equal(scrubMessage("refresh_token=abc123 rejected"), "refresh_token=[REDACTED] rejected");
  assert.equal(scrubMessage("plain failure"), "plain failure");
});

test("production logs an Error as name, code and scrubbed message without a stack", () => {
  Reflect.set(process.env, "NODE_ENV", "production");
  delete process.env.LOG_ERROR_STACKS;
  const error = Object.assign(new Error("call https://api.test/x?key=abc failed"), { code: "ECONNRESET" });
  const entry = capture(() => logger.error("boom", { error }));
  assert.deepEqual(entry.error, { name: "Error", code: "ECONNRESET", message: "call https://api.test/x?[REDACTED] failed" });
});

test("stacks are an explicit opt-in in production", () => {
  Reflect.set(process.env, "NODE_ENV", "production");
  process.env.LOG_ERROR_STACKS = "1";
  const entry = capture(() => logger.error("boom", { error: new Error("x") }));
  assert.equal(typeof (entry.error as { stack?: string }).stack, "string");
});
