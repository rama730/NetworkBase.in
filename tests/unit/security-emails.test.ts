import assert from "node:assert/strict";
import { test } from "node:test";

import { SECURITY_EMAIL_KINDS, buildSecurityEmail, isDeletionEmailKind, isSecurityEmailKind } from "@/lib/email/security-templates";

process.env.APP_URL = "https://networkbase.in";
const person = { email: "ada@example.com", name: "Ada <Lovelace>", username: "ada", userId: "u-1" };
const at = "2026-10-28T10:15:00.000Z";
const hardDeleteAt = "2026-11-27T00:00:00.000Z";

test("every kind renders a subject, plain text, HTML and a primary link that points back into the app", () => {
    for (const kind of SECURITY_EMAIL_KINDS) {
        const email = buildSecurityEmail(kind, { at, hardDeleteAt, daysLeft: 7, detail: "added" }, person);
        assert.ok(email.subject.length > 0, kind);
        assert.deepEqual(email.to, ["ada@example.com"]);
        assert.match(email.html, /https:\/\/networkbase\.in\/(settings|login|support)/, kind);
        assert.match(email.text, /https:\/\/networkbase\.in\/(settings|login|support)/, kind);
    }
});

test("these emails cannot be unsubscribed from, so they carry no unsubscribe header and say why", () => {
    const email = buildSecurityEmail("security_password_changed", { at }, person);
    assert.equal(email.headers, undefined);
    assert.match(email.text, /can’t be turned off/);
});

test("a name with markup is escaped in the HTML", () => {
    const email = buildSecurityEmail("security_password_changed", { at }, person);
    assert.doesNotMatch(email.html, /<Lovelace>/);
    assert.match(email.html, /Ada &lt;Lovelace&gt;/);
});

test("a changed password, token and authenticator each say what happened and what to do if it wasn't you", () => {
    assert.match(buildSecurityEmail("security_password_changed", { at }, person).text, /If this wasn't you/);
    assert.match(buildSecurityEmail("security_token_created", { at, detail: "Workstation" }, person).text, /Workstation/);
    assert.match(buildSecurityEmail("security_mfa_changed", { at, detail: "removed" }, person).subject, /Sign-in protection changed/);
    assert.match(buildSecurityEmail("security_mfa_changed", { at, detail: "removed" }, person).text, /removed/);
});

test("the deletion emails name the date and send the person to cancel", () => {
    const scheduled = buildSecurityEmail("account_deletion_scheduled", { at, hardDeleteAt }, person);
    assert.match(scheduled.text, /November 27, 2026/);
    assert.match(scheduled.text, /Cancel deletion: https:\/\/networkbase\.in\/login\?redirect=/);
    assert.match(buildSecurityEmail("account_deletion_reminder", { hardDeleteAt, daysLeft: 1 }, person).subject, /tomorrow/);
    assert.match(buildSecurityEmail("account_deletion_reminder", { hardDeleteAt, daysLeft: 7 }, person).subject, /in 7 days/);
    assert.match(buildSecurityEmail("account_deletion_cancelled", { at }, person).text, /reactivated/);
});

test("kind guards", () => {
    assert.equal(isSecurityEmailKind("security_mfa_changed"), true);
    assert.equal(isSecurityEmailKind("task_assignment"), false);
    assert.equal(isDeletionEmailKind("account_deletion_reminder"), true);
    assert.equal(isDeletionEmailKind("security_password_changed"), false);
});
