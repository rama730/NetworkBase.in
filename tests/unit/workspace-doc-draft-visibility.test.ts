import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveWorkspaceDocPermission } from "../../src/lib/workspaces/doc";

// COR-034: an outsider must never read a draft project's documents.
const outsider = { actorUserId: "viewer", projectVisibility: "public", publicTabVisibility: { readme: true }, hasPublishedReadme: true };

test("outsiders cannot read published docs of a draft project, even with a public override", () => {
  for (const settings of [undefined, { visibilityOverride: "public" }]) {
    for (const projectStatus of ["draft", null, ""]) {
      const permission = resolveWorkspaceDocPermission({ ...outsider, settings, projectStatus });
      assert.equal(permission.canReadPublished, false, `${JSON.stringify(settings)} status=${projectStatus}`);
      assert.equal(permission.accessLevel, "none");
    }
  }
});

test("outsiders still read published docs of an active public project; owners read drafts", () => {
  assert.equal(resolveWorkspaceDocPermission({ ...outsider, projectStatus: "active" }).canReadPublished, true);
  assert.equal(resolveWorkspaceDocPermission({ ...outsider, projectStatus: "draft", isOwner: true }).canReadPublished, true);
});

test("a public override never publishes a doc out of a private project or a hidden Readme tab", () => {
  const base = { ...outsider, projectStatus: "active", settings: { visibilityOverride: "public" } };
  assert.equal(resolveWorkspaceDocPermission({ ...base, projectVisibility: "private" }).canReadPublished, false);
  assert.equal(resolveWorkspaceDocPermission({ ...base, publicTabVisibility: { readme: false } }).canReadPublished, false);
  assert.equal(resolveWorkspaceDocPermission(base).canReadPublished, true);
});

test("viewers read documents but never edit or publish them, even where members may edit (found in A0.4)", () => {
  const member = { actorUserId: "u1", projectVisibility: "private", projectStatus: "active", isActiveMember: true, settings: { editPolicy: "members" } };
  const viewer = resolveWorkspaceDocPermission({ ...member, membershipRole: "viewer" });
  assert.deepEqual([viewer.canReadPublished, viewer.canEdit, viewer.canPublish], [true, false, false]);
  const plain = resolveWorkspaceDocPermission({ ...member, membershipRole: "member" });
  assert.deepEqual([plain.canEdit, plain.canPublish], [true, true]);
});
