import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHILD_ACTIONS,
  CHILD_ROLES,
  ORG_ACTIONS,
  ORG_ROLES,
  childGrant,
  orgGrant,
} from "../../src/lib/organizations/permissions";

// Invariants from the report's permissions matrix (§29.4). The matrix itself lives in permissions.ts.
describe("organization permissions", () => {
  it("keeps owner-only org actions to the owner", () => {
    for (const action of ["edit_identity", "manage_admins", "org_lifecycle"] as const) {
      for (const role of ORG_ROLES) {
        assert.equal(orgGrant(role, action) === "yes", role === "owner", `${action} for ${role}`);
      }
    }
  });

  it("keeps guests read-only", () => {
    const allowed = new Set(["open_dashboard", "open_about", "leave"]);
    for (const action of ORG_ACTIONS) {
      if (orgGrant("guest", action) === "yes") assert.ok(allowed.has(action), `guest can ${action}`);
    }
  });

  it("gives visitors only the About page outright", () => {
    for (const action of ORG_ACTIONS) {
      if (orgGrant("visitor", action) === "yes") assert.equal(action, "open_about");
    }
  });

  it("never lets members manage the org", () => {
    for (const action of ["manage_joining", "invite_members_guests", "review_join_requests", "remove_members_guests", "members_tab", "announce", "run_sprints", "create_assignments", "review_submissions", "edit_docs", "manage_files", "verify_contributions"] as const) {
      assert.equal(orgGrant("member", action), "no", action);
    }
  });

  it("limits inherited org admins in child projects", () => {
    for (const action of ["delete", "transfer_ownership", "edit_general"] as const) {
      assert.equal(childGrant("inherited_admin", action), "no", action);
    }
    assert.equal(childGrant("inherited_admin", "archive"), "yes");
    assert.equal(childGrant("inherited_admin", "detach"), "yes");
    assert.equal(childGrant("lead", "detach"), "request");
  });

  it("keeps outside people and visitors out of org content", () => {
    assert.equal(childGrant("outside", "see_org_content"), "no");
    assert.equal(childGrant("outside", "share_to_org"), "no");
    for (const action of CHILD_ACTIONS) {
      assert.notEqual(childGrant("visitor", action), "yes", action);
    }
  });

  it("only the lead deletes, transfers or edits General", () => {
    for (const action of ["delete", "transfer_ownership", "edit_general"] as const) {
      for (const role of CHILD_ROLES) {
        assert.equal(childGrant(role, action) === "yes", role === "lead", `${action} for ${role}`);
      }
    }
  });
});
