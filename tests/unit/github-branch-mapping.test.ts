import assert from "node:assert/strict";
import test from "node:test";

import { mapLocalSide } from "../../src/lib/github/branch-mapping";

// Report H6 (M8, phase H-5): GitHub branch to NetworkBase branch, by name; the default branch is main.
const base = { branchesOn: true, direction: "pull" as const, githubBranch: "feature-x", defaultBranch: "main", newBranch: false, nbBranch: null };

test("the default branch is main; Branches off is always main", () => {
  assert.deepEqual(mapLocalSide({ ...base, githubBranch: "main" }), { kind: "main" });
  assert.deepEqual(mapLocalSide({ ...base, defaultBranch: "trunk", githubBranch: "trunk" }), { kind: "main" });
  assert.deepEqual(mapLocalSide({ ...base, branchesOn: false }), { kind: "main" });
});

test("another GitHub branch is the NetworkBase branch of that name; a pull creates it, a push without it sends main", () => {
  assert.deepEqual(mapLocalSide({ ...base, nbBranch: { id: "b1", status: "active" } }), { kind: "branch", branchId: "b1" });
  assert.deepEqual(mapLocalSide(base), { kind: "create" });
  assert.deepEqual(mapLocalSide({ ...base, nbBranch: { id: "b1", status: "deleted" } }), { kind: "create" }, "a deleted twin is made again");
  assert.deepEqual(mapLocalSide({ ...base, direction: "push" }), { kind: "main" });
  assert.deepEqual(mapLocalSide({ ...base, direction: "push", nbBranch: { id: "b1", status: "active" } }), { kind: "branch", branchId: "b1" });
});

test("pushing main to a new GitHub branch stays main", () => {
  assert.deepEqual(mapLocalSide({ ...base, direction: "push", newBranch: true, nbBranch: { id: "b1", status: "active" } }), { kind: "main" });
});
