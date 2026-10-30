import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { CURRENT_LEGAL_ACCEPTANCE, LEGAL_VERSIONS } from "@/lib/legal/versions";
import { componentSource } from "./_helpers/component-source";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("all public legal routes exist and use a versioned document surface", () => {
  const pages = [
    "privacy", "terms", "eula", "acceptable-use", "cookies", "subprocessors",
    "copyright", "grievances", "security-reporting", "dpa", "open-source",
  ];
  for (const page of pages) {
    const source = read(`src/app/(legal)/${page}/page.tsx`);
    assert.match(source, /LegalDocumentPage/);
    assert.match(source, /LEGAL_VERSIONS/);
  }
});

test("public legal documents are discoverable and security reports have a standard contact", () => {
  const sitemap = read("src/app/sitemap.ts");
  const robots = read("src/app/robots.ts");
  const security = read("src/app/.well-known/security.txt/route.ts");

  for (const path of ["/privacy", "/terms", "/eula", "/security-reporting"]) {
    assert.match(sitemap, new RegExp(path.replace("/", "\\/")));
    assert.match(robots, new RegExp(path.replace("/", "\\/")));
  }
  assert.match(robots, /sitemap\.xml/);
  assert.match(security, /Contact: mailto:/);
  assert.match(security, /Expires:/);
  assert.match(security, /Canonical:/);
  assert.match(security, /Policy:/);
});

test("security reporting and privacy policies publish all four official email channels", () => {
  const securityReporting = read("src/app/(legal)/security-reporting/page.tsx");
  const privacy = read("src/app/(legal)/privacy/page.tsx");

  for (const address of [
    "welcome@networkbase.in",
    "notifications@networkbase.in",
    "support@networkbase.in",
    "privacy@networkbase.in",
  ]) {
    assert.match(securityReporting, new RegExp(address));
    assert.match(privacy, new RegExp(address));
  }
});

test("signup requires affirmative age, terms, EULA, and privacy acknowledgement", () => {
  const signup = read("src/components/auth/SignupForm.tsx");
  const route = read("src/app/api/v1/auth/signup/route.ts");
  assert.match(signup, /I am at least 18/);
  assert.match(signup, /Terms of Service/);
  assert.match(signup, /EULA/);
  assert.match(signup, /Privacy Policy/);
  assert.match(route, /legalAccepted: z\.literal\(true\)/);
  assert.match(route, /recordCurrentLegalAcceptance/);
});

test("existing signed-in accounts must accept the current unexpired versions", () => {
  const layout = read("src/app/(site)/(main)/layout.tsx");
  const requestBoundary = read("src/proxy.ts");
  const acceptance = read("src/lib/legal/acceptance.ts");
  const page = read("src/app/(site)/legal/accept/page.tsx");

  assert.match(layout, /hasCurrentLegalAcceptance\(user\.id\)/);
  assert.match(layout, /redirect\(`\/legal\/accept\?next=/);
  assert.match(requestBoundary, /x-networkbase-request-target/);
  assert.match(acceptance, /gt\(legalAcceptances\.retentionExpiresAt, new Date\(\)\)/);
  assert.match(page, /"material_update"/);
});

test("current acceptance binds matching Terms, EULA, and privacy notice versions", () => {
  assert.equal(CURRENT_LEGAL_ACCEPTANCE.termsVersion, LEGAL_VERSIONS.terms);
  assert.equal(CURRENT_LEGAL_ACCEPTANCE.eulaVersion, LEGAL_VERSIONS.eula);
  assert.equal(CURRENT_LEGAL_ACCEPTANCE.privacyNoticeVersion, LEGAL_VERSIONS.privacy);
});

test("grievance contact falls back to the monitored privacy mailbox", () => {
  const config = read("src/lib/legal/config.ts");
  assert.match(config, /const privacyEmail = value\("LEGAL_PRIVACY_EMAIL"/);
  assert.match(config, /grievanceEmail: value\("LEGAL_GRIEVANCE_EMAIL", privacyEmail\)/);
  const readiness = read("scripts/check-legal-readiness.ts");
  const requiredContacts = readiness.match(/const REQUIRED_CONTACTS = \[[\s\S]*?\] as const;/)?.[0] ?? "";
  assert.doesNotMatch(requiredContacts, /LEGAL_GRIEVANCE_EMAIL/);
  assert.match(readiness, /const OPTIONAL_CONTACTS = \["LEGAL_GRIEVANCE_EMAIL"\] as const/);
});

test("settings and project detail expose contextual legal controls", () => {
  const settingsDocument = read("src/components/settings/SettingsDocument.tsx");
  assert.match(settingsDocument, /LegalAndDataRightsSection/);
  assert.ok(settingsDocument.indexOf('id="settings-privacy-policies"') > settingsDocument.indexOf('id="settings-integrations"'));
  const layout = read("src/components/workspaces/dashboard/WorkspaceLayout.tsx");
  assert.doesNotMatch(layout, /id: "privacy", label: "Privacy & terms"/);
  const settings = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");
  assert.match(settings, /"privacy-policies": Scale/);
  assert.match(settings, /LegalAndDataRightsSection/);
  const policies = read("src/lib/workspaces/settings-policies.ts");
  assert.ok(policies.indexOf('"privacy-policies"') > policies.indexOf('"notifications"'));
  assert.ok(policies.indexOf('"danger"') > policies.indexOf('"privacy-policies"'));
});

test("retention jobs expire legal evidence and anonymize deletion records", () => {
  const retention = read("src/inngest/functions/data-lifecycle-retention.ts");
  assert.match(retention, /expired_legal_acceptances/);
  assert.match(retention, /anonymized_account_deletion_records/);
  assert.match(read("drizzle/0002_profiles_accounts.sql"), /legal_retention_until timestamp with time zone NOT NULL/);
});

test("legal evidence uses keyed pseudonymous hashes rather than raw network metadata", () => {
  const acceptance = read("src/lib/legal/acceptance.ts");
  assert.match(acceptance, /createHmac\("sha256"/);
  assert.match(acceptance, /AUDIT_METADATA_HASH_SECRET must be configured in production/);
  assert.doesNotMatch(acceptance, /createHash\("sha256"/);
  assert.doesNotMatch(acceptance, /networkbase-development-legal-evidence/);
  assert.doesNotMatch(acceptance, /ipAddress:/);
  assert.doesNotMatch(acceptance, /userAgent:/);
});
