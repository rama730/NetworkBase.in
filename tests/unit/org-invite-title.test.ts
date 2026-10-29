import assert from "node:assert/strict";
import test from "node:test";

import { orgRoleNames } from "../../src/lib/organizations/config";

test("org invite role uses the organization's own role names", () => {
  assert.equal(orgRoleNames("education", null).admin, "TA");
  assert.equal(orgRoleNames("community", { roleNames: { member: "Volunteer" } }).member, "Volunteer");
  assert.equal(orgRoleNames(null, { roleNames: { viewer: "  " } }).viewer, orgRoleNames(null, null).viewer);
});
