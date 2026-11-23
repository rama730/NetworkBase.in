import assert from "node:assert/strict";
import test from "node:test";

import { activeAgo, logDate, shortIp, clockTime } from "@/lib/settings/format";
import { searchSettings, type FindEntry } from "@/lib/settings/find";
import { checkupItems, navStates, deletionDays } from "@/lib/settings/checkup";

const NOW = new Date("2026-11-23T15:00:00Z");
const tz = "UTC";

test("log dates are day and short month, two-digit day; another year shows the year instead of the day", () => {
  assert.equal(logDate("2026-10-28T10:00:00Z", NOW, tz), "28 Oct");
  assert.equal(logDate("2026-10-02T10:00:00Z", NOW, tz), "02 Oct");
  assert.equal(logDate("2025-09-29T10:00:00Z", NOW, tz), "Sep 2025");
  assert.equal(logDate("not a date", NOW, tz), "");
});

test("last active reads like a person says it", () => {
  assert.equal(activeAgo("2026-11-23T14:58:00Z", NOW, tz), "active now");
  assert.equal(activeAgo("2026-11-23T14:40:00Z", NOW, tz), "active 20 min ago");
  assert.equal(activeAgo("2026-11-23T13:00:00Z", NOW, tz), "active 2 h ago");
  assert.equal(activeAgo("2026-11-22T10:00:00Z", NOW, tz), "active yesterday");
  assert.equal(activeAgo("2026-11-20T10:00:00Z", NOW, tz), "active 3 days ago");
  assert.equal(activeAgo("2026-10-28T10:00:00Z", NOW, tz), "active 28 Oct");
  assert.equal(activeAgo(null, NOW, tz), "");
});

test("an IP address is shortened to its network part", () => {
  assert.equal(shortIp("203.0.113.42"), "203.0.113.·");
  assert.equal(shortIp("2001:db8:85a3::8a2e:370:7334"), "2001:db8:85a3:·");
  assert.equal(shortIp("::ffff:198.51.100.7"), "198.51.100.·");
  assert.equal(shortIp(""), "");
  assert.equal(shortIp(null), "");
  assert.equal(shortIp("unknown"), "");
});

test("clock time has no seconds", () => {
  assert.equal(clockTime("2026-11-23T15:30:45Z", tz), "3:30 PM");
});

const entries: FindEntry[] = [
  { id: "settings-security-password", section: "Security", title: "Password", keywords: "change reset" },
  { id: "settings-security-twostep", section: "Security", title: "Two-step verification", keywords: "2fa mfa authenticator" },
  { id: "settings-appearance-theme", section: "Appearance", title: "Theme", keywords: "dark light mode" },
  { id: "settings-privacy-blocked", section: "Privacy", title: "Blocked people", keywords: "block" },
];

test("find matches titles first, then keywords, and every word must match", () => {
  assert.deepEqual(searchSettings(entries, "pass").map((e) => e.id), ["settings-security-password"]);
  assert.deepEqual(searchSettings(entries, "2fa").map((e) => e.id), ["settings-security-twostep"]);
  assert.deepEqual(searchSettings(entries, "dark mode").map((e) => e.id), ["settings-appearance-theme"]);
  assert.deepEqual(searchSettings(entries, "security").map((e) => e.id), ["settings-security-password", "settings-security-twostep"]);
  assert.deepEqual(searchSettings(entries, "  ").map((e) => e.id), []);
  assert.deepEqual(searchSettings(entries, "zzz").map((e) => e.id), []);
});

test("find puts a title that starts with the words above one that only contains them", () => {
  const list: FindEntry[] = [
    { id: "a", section: "Account", title: "Clear email cache", keywords: "" },
    { id: "b", section: "Account", title: "Email", keywords: "" },
  ];
  assert.deepEqual(searchSettings(list, "email").map((e) => e.id), ["b", "a"]);
});

test("the check-up lists what needs you, recovery codes only once two-step is on, and blocked notifications only when blocked", () => {
  const base = { emailVerified: false, twoStepOn: false, recoveryCodesLeft: 0, browserPermission: "default" as const, termsAccepted: true };
  assert.deepEqual(checkupItems(base).map((i) => [i.id, i.done]), [["email", false], ["twostep", false], ["terms", true]]);
  const secure = checkupItems({ ...base, emailVerified: true, twoStepOn: true, recoveryCodesLeft: 10, browserPermission: "denied" });
  assert.deepEqual(secure.map((i) => [i.id, i.done]), [["email", true], ["twostep", true], ["codes", true], ["browser", false], ["terms", true]]);
  assert.equal(checkupItems({ ...base, twoStepOn: true, recoveryCodesLeft: 2 }).find((i) => i.id === "codes")?.done, false, "two or fewer codes left needs new ones");
  assert.equal(checkupItems({ ...base, termsAccepted: null }).some((i) => i.id === "terms"), false, "unknown terms state is left out, not guessed");
});

test("the nav shows a state only where something needs you", () => {
  assert.deepEqual(navStates({ emailVerified: true, twoStepOn: true, recoveryCodesLeft: 10, paused: false, deleteOn: null }), {});
  assert.deepEqual(navStates({ emailVerified: false, twoStepOn: false, recoveryCodesLeft: 0, paused: true, deleteOn: "23 Dec" }), { account: "Verify", security: "2FA off", notifications: "Paused", "delete-account": "23 Dec" });
  assert.deepEqual(navStates({ emailVerified: true, twoStepOn: true, recoveryCodesLeft: 1, paused: false, deleteOn: null }), { security: "Codes" });
});

test("the deletion countdown has 30 squares and counts whole days left", () => {
  assert.deepEqual(deletionDays("2026-12-23T00:00:00Z", NOW), { left: 30, total: 30 });
  assert.deepEqual(deletionDays("2026-11-24T00:00:00Z", NOW), { left: 1, total: 30 });
  assert.deepEqual(deletionDays("2026-11-01T00:00:00Z", NOW), { left: 0, total: 30 });
});
