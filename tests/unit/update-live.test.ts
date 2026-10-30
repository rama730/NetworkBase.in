import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { acceptSeq, releaseCardJoin, resetUpdateLiveState, takeCardJoin } from "../../src/lib/realtime/update-live-state";

test("versions: repeats are harmless, anything older is ignored", () => {
  resetUpdateLiveState();
  assert.equal(acceptSeq("a", 2), true);
  assert.equal(acceptSeq("a", 2), true);
  assert.equal(acceptSeq("a", 1), false);
  assert.equal(acceptSeq("a", 3), true);
  assert.equal(acceptSeq("b", 1), true, "per post");
  assert.equal(acceptSeq("a", undefined), true, "events without a version still apply");
});

test("Discover holds a limited number of live cards (RT4)", () => {
  resetUpdateLiveState();
  for (let i = 0; i < 20; i += 1) assert.equal(takeCardJoin(), true);
  assert.equal(takeCardJoin(), false);
  releaseCardJoin();
  assert.equal(takeCardJoin(), true);
});

test("an author sees live counts on their own post: nothing filters events by author (G1)", () => {
  const tab = readFileSync("src/components/workspaces/tabs/UpdatesTab.tsx", "utf8");
  const live = readFileSync("src/hooks/useUpdateLive.ts", "utf8");
  assert.match(tab, /useWorkspaceUpdatesLive\(projectId/);
  assert.doesNotMatch(tab, /author_id|subscribeActiveResource/);
  assert.doesNotMatch(live, /authorId|author_id/);
});

test("no screen listens to database rows for updates any more (RT2)", () => {
  for (const file of ["src/components/discover/DiscoverUpdateThread.tsx", "src/components/workspaces/updates/WorkspaceUpdateLikersModal.tsx"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /subscribeActiveResource|postgres_changes/, file);
  }
});
