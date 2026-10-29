import assert from "node:assert/strict";
import { test } from "node:test";

import { capChildVisibility, childCreationBlock, allowedChildVisibilities } from "../../src/lib/organizations/child-rules";

// Report §14.2 (who can create) and §14.3 / §21.7 (visibility cap).
test("who can create child projects", () => {
  assert.equal(childCreationBlock("owner", "admins", true), null);
  assert.equal(childCreationBlock("admin", "admins", true), null);
  assert.equal(childCreationBlock("member", "members", true), null);
  assert.equal(childCreationBlock("member", "admins", true), "Only admins create workspaces here.");
  assert.equal(childCreationBlock("viewer", "members", true), "Viewers can’t create workspaces.");
  assert.equal(childCreationBlock(null, "members", true), "You’re not a member of this organization.");
  assert.equal(childCreationBlock("owner", "members", false), "This organization is archived.");
});

test("the cap lowers visibility; a private org caps at Organization", () => {
  assert.equal(capChildVisibility("public", "public", true), "public");
  assert.equal(capChildVisibility("public", "org", true), "org");
  assert.equal(capChildVisibility("public", "public", false), "org", "a private org has no public children");
  assert.equal(capChildVisibility("org", "private", true), "private");
  assert.equal(capChildVisibility("private", "public", true), "private", "lower is always allowed");
  assert.deepEqual(allowedChildVisibilities("org", true), ["org", "private"]);
  assert.deepEqual(allowedChildVisibilities("public", true), ["public", "org", "private"]);
});
