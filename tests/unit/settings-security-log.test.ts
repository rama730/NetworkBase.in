import assert from "node:assert/strict";
import test from "node:test";

import { buildSecurityLog } from "@/lib/settings/security-log";
import type { LoginHistoryEntry, SecurityActivityEntry, Session } from "@/types/settingsTypes";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
const activity = (id: string, eventType: SecurityActivityEntry["eventType"], createdAt: string): SecurityActivityEntry => ({ id, eventType, createdAt, networkFingerprint: "a3f9", deviceFingerprint: "b7c1", metadata: {} } as SecurityActivityEntry);
const signIn = (id: string, ua: string, created_at: string, extra: Partial<LoginHistoryEntry> = {}): LoginHistoryEntry => ({ id, ip_address: "203.0.113.42", user_agent: ua, created_at, ...extra });
const session = (ua: string) => ({ id: "s", device_info: { userAgent: ua }, ip_address: "203.0.113.5", created_at: "2026-10-01T00:00:00Z", last_active: "2026-10-28T00:00:00Z", is_current: true } as unknown as Session);

test("changes and sign-ins are one list, newest first", () => {
  const log = buildSecurityLog([activity("a1", "password_changed", "2026-10-28T10:00:00Z")], [signIn("h1", MAC, "2026-10-29T10:00:00Z"), signIn("h0", MAC, "2026-10-20T10:00:00Z")], [session(MAC)]);
  assert.deepEqual(log.map((entry) => entry.key), ["signin:h1", "activity:a1", "signin:h0"]);
  assert.equal(log[1]!.label, "Password changed");
  assert.equal(log[1]!.detail, "network a3f9 · device b7c1");
});

test("a sign-in reads browser, system, the shortened address, the place and two-step", () => {
  const [entry] = buildSecurityLog([], [signIn("h1", MAC, "2026-10-29T10:00:00Z", { location: "Delhi", aal: "aal2" })], [session(MAC)]);
  assert.equal(entry!.label, "Signed in");
  assert.match(entry!.detail, /^Chrome on macOS · 203\.0\.113\.· · Delhi · with two-step$/);
  assert.equal(entry!.risky, null);
});

test("a sign-in from a browser seen nowhere else is flagged; the very first sign-in is not", () => {
  const log = buildSecurityLog([], [signIn("h2", WIN, "2026-10-24T10:00:00Z"), signIn("h1", MAC, "2026-10-20T10:00:00Z"), signIn("h0", MAC, "2026-10-01T10:00:00Z")], [session(MAC)]);
  assert.equal(log.find((entry) => entry.key === "signin:h2")!.risky, "New browser");
  assert.equal(log.find((entry) => entry.key === "signin:h0")!.risky, null);
  const first = buildSecurityLog([], [signIn("only", WIN, "2026-10-24T10:00:00Z")], []);
  assert.equal(first[0]!.risky, null, "one sign-in alone is the first, not a new browser");
});

test("a sign-in from a new country and a failed recovery code are flagged", () => {
  const log = buildSecurityLog([activity("c", "token_new_country", "2026-10-28T10:00:00Z"), activity("f", "recovery_code_redemption_failed", "2026-10-27T10:00:00Z"), activity("p", "password_changed", "2026-10-26T10:00:00Z")], [], []);
  assert.deepEqual(log.map((entry) => entry.risky), ["New country", "Failed code", null]);
});
