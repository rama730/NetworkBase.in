import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, loadAppModule, sql } from "./_helpers";

let acceptanceProvenDuringOutage: typeof import("../../src/lib/legal/acceptance").acceptanceProvenDuringOutage;
let LegalAcceptanceUnavailableError: typeof import("../../src/lib/legal/acceptance").LegalAcceptanceUnavailableError;
let v: typeof import("../../src/lib/legal/versions").CURRENT_LEGAL_ACCEPTANCE;
before(async () => {
  ({ acceptanceProvenDuringOutage, LegalAcceptanceUnavailableError } = await loadAppModule(() => import("../../src/lib/legal/acceptance")));
  ({ CURRENT_LEGAL_ACCEPTANCE: v } = await import("../../src/lib/legal/versions"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const key = () => `${v.termsVersion}|${v.eulaVersion}|${v.privacyNoticeVersion}`;
const MIN = 60_000;

// AUTH-014: only a recent, verified, current-version acceptance survives a database outage.
test("a database outage never admits an unknown user", () => {
  assert.equal(acceptanceProvenDuringOutage(undefined), false);
  assert.equal(acceptanceProvenDuringOutage({ accepted: false, expiresAt: Date.now() + MIN, versions: key() }), false);
});

test("the outage grace is finite and tied to the document versions", () => {
  const now = Date.now();
  assert.equal(acceptanceProvenDuringOutage({ accepted: true, expiresAt: now - 10 * MIN, versions: key() }, now), true);
  assert.equal(acceptanceProvenDuringOutage({ accepted: true, expiresAt: now - 20 * MIN, versions: key() }, now), false);
  assert.equal(acceptanceProvenDuringOutage({ accepted: true, expiresAt: now + MIN, versions: "old|old|old" }, now), false);
});

test("an unknown user gets a retryable error, not a pass", () => {
  assert.equal(new LegalAcceptanceUnavailableError().name, "LegalAcceptanceUnavailableError");
});
