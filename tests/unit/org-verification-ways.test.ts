import assert from "node:assert/strict";
import { test } from "node:test";

import { codeSendWindow, githubOrgOf, maskEmail, ownWebsites, proofFound, recheckVerification, verificationEmailDomain, verifiedLabel, VERIFY_CODE_SENDS_PER_HOUR } from "../../src/lib/organizations/trust-rules";

// Verified badge, four ways (2026-11-05-org-address-discovery-verification-findings.md §5, §7).

test("way 1: a school or work address gives its domain; free mail and nonsense don't", () => {
  assert.deepEqual(verificationEmailDomain(" Rama@RVCE.edu.in "), { domain: "rvce.edu.in" });
  assert.ok("error" in verificationEmailDomain("someone@gmail.com"));
  assert.ok("error" in verificationEmailDomain("not an email"));
  assert.equal(maskEmail("rama@rvce.edu.in"), "r…@rvce.edu.in");
});

test("way 1 limits: 3 sends an hour, and 45 seconds between sends", () => {
  const now = new Date("2026-11-05T10:00:00Z");
  const ago = (s: number) => new Date(now.getTime() - s * 1000);
  assert.deepEqual(codeSendWindow([], now), { recent: [], allowed: true, waitSeconds: 0 });
  assert.equal(codeSendWindow([ago(10)], now).waitSeconds, 35, "Resend in 0:35");
  assert.equal(codeSendWindow([ago(10)], now).allowed, false);
  assert.equal(codeSendWindow([ago(3000), ago(2000), ago(60)], now).allowed, false, `${VERIFY_CODE_SENDS_PER_HOUR} this hour`);
  assert.equal(codeSendWindow([ago(4000), ago(2000), ago(60)], now).allowed, true, "one of them is older than an hour");
});

test("way 3: the code is found in the text; GitHub and own websites are told apart", () => {
  assert.equal(proofFound("<meta name=x content='networkbase-verify-abc'>", "networkbase-verify-abc"), true);
  assert.equal(proofFound("nothing here", "networkbase-verify-abc"), false);
  assert.equal(proofFound(null, "networkbase-verify-abc"), false);
  assert.equal(githubOrgOf("https://github.com/Acme/repo"), "acme");
  assert.equal(githubOrgOf("github.com/acme"), "acme");
  assert.equal(githubOrgOf("https://acme.com"), null);
  assert.deepEqual(ownWebsites(["https://github.com/acme", "https://www.acme.com", "https://linkedin.com/company/acme"]), ["https://www.acme.com"]);
});

test("rechecks follow how the badge was earned", () => {
  const moved = { websites: ["https://other.example.com"] };
  assert.equal(recheckVerification({ verified: true, domain: "acme.com", method: "website" }, moved), "remove", "a website code goes with the website");
  assert.equal(recheckVerification({ verified: true, domain: "acme.com", method: "owner_email" }, moved), "remove");
  assert.equal(recheckVerification({ verified: true, domain: null, method: "email" }, moved), "keep", "an email code isn't tied to Links");
  assert.equal(recheckVerification({ verified: true, domain: null, method: "dns" }, { renamed: true }), "keep", "a domain proof survives a rename");
  for (const method of ["team", "parent", "github"] as const) {
    assert.equal(recheckVerification({ verified: true, domain: null, method }, { renamed: true }), "request_again", `${method}: a rename goes back to review`);
  }
  assert.equal(recheckVerification({ verified: true, domain: null }, { renamed: true }), "request_again", "a badge from before 0064 with no domain was the team's");
});

test("D2: the ✓ says what it was checked against", () => {
  assert.equal(verifiedLabel("email", "rvce.edu.in"), "Verified · rvce.edu.in");
  assert.equal(verifiedLabel("parent", "Part of Northgate Institute"), "Verified · Part of Northgate Institute");
  assert.equal(verifiedLabel("github", "github.com/acme"), "Verified · github.com/acme");
  assert.equal(verifiedLabel("team", null), "Verified by the NetworkBase team");
  assert.equal(verifiedLabel(null, null), "Verified by the NetworkBase team");
});

test("Settings: On Discover, Web address and Verified badge sit in Visibility and discovery, after Visibility and before What visitors can see; Details keeps neither", async () => {
  const fs = await import("node:fs");
  const tab = fs.readFileSync("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx", "utf8");
  const access = tab.slice(tab.indexOf('id="project-settings-access"'));
  const order = ["Visibility\" : \"Workspace visibility\"", "<OrgOnDiscover", "<OrgWebAddress", "<OrgVerifiedBadge", "What visitors can see"].map((needle) => access.indexOf(needle));
  assert.ok(order.every((at) => at > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "in the report's order");
  assert.doesNotMatch(tab, /OrgHandleSection|OrgVerificationSection/, "nothing left in Details");
  const { ORG_REUSED_LABELS } = await import("../../src/lib/organizations/settings");
  assert.equal(ORG_REUSED_LABELS.access, "Visibility and discovery");
});
