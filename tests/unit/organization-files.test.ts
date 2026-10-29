import assert from "node:assert/strict";
import { test } from "node:test";

import { canSeeNode, effectiveAccess, folderAccessBlock, readFolderAccess, starterFolders } from "../../src/lib/organizations/file-rules";

test("the strictest folder mark wins; unmarked is Members", () => {
  assert.equal(effectiveAccess([null, "public", "admins"]), "admins");
  assert.equal(effectiveAccess(["public", undefined]), "public");
  assert.equal(effectiveAccess([]), null);
  assert.equal(canSeeNode("member", null), true);
  assert.equal(canSeeNode("member", "admins"), false);
  assert.equal(canSeeNode("visitor", null), false, "unmarked is Members, not public");
  assert.equal(canSeeNode("visitor", "public"), true);
  assert.equal(canSeeNode("admin", "admins"), true);
});

test("access is only stricter going down", () => {
  assert.equal(folderAccessBlock(null, "public"), null, "top-level folders can be Public");
  assert.equal(folderAccessBlock("public", "admins"), null);
  assert.match(folderAccessBlock("members", "public") ?? "", /can't be more open/);
  assert.match(folderAccessBlock("admins", "members") ?? "", /Admins only/);
  assert.equal(folderAccessBlock("admins", null), null, "clearing a mark keeps the parent's");
  assert.equal(readFolderAccess({ access: "admins" }), "admins");
  assert.equal(readFolderAccess({ access: "everyone" }), null);
});

test("starter folders by type end with an Admins-only folder", () => {
  assert.deepEqual(starterFolders("education").map((f) => f.name), ["Course materials", "Docs", "Templates", "Staff"]);
  assert.deepEqual(starterFolders("company").map((f) => f.name), ["Shared", "Docs", "Templates", "Managers"]);
  assert.equal(starterFolders("club").at(-1)?.access, "admins");
});
