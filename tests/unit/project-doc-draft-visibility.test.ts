import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveProjectDocPermission } from "../../src/lib/projects/doc";

// COR-034: an outsider must never read a draft project's documents.
const outsider = { actorUserId: "viewer", projectVisibility: "public", publicTabVisibility: { readme: true }, hasPublishedReadme: true };

test("outsiders cannot read published docs of a draft project, even with a public override", () => {
  for (const settings of [undefined, { visibilityOverride: "public" }]) {
    for (const projectStatus of ["draft", null, ""]) {
      const permission = resolveProjectDocPermission({ ...outsider, settings, projectStatus });
      assert.equal(permission.canReadPublished, false, `${JSON.stringify(settings)} status=${projectStatus}`);
      assert.equal(permission.accessLevel, "none");
    }
  }
});

test("outsiders still read published docs of an active public project; owners read drafts", () => {
  assert.equal(resolveProjectDocPermission({ ...outsider, projectStatus: "active" }).canReadPublished, true);
  assert.equal(resolveProjectDocPermission({ ...outsider, projectStatus: "draft", isOwner: true }).canReadPublished, true);
});
