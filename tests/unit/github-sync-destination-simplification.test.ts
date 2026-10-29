import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("Reviewed GitHub Sync destinations", () => {
  const source = readFileSync(
    "src/components/workspaces/v2/files-tab/RepositorySync.tsx",
    "utf8",
  );
  it("keeps repository context compact and target edits behind settings", () => {
    assert.match(source, /className=\{styles.repoRow\}/);
    assert.match(source, /setTarget\(connection\)/);
    assert.match(source, /title="Repository settings"/);
    assert.match(source, /Review destination/);
    assert.doesNotMatch(
      source,
      /handleSwitchBranch|group\/branch|\+ Custom branch/,
    );
  });
  it("requires explicit confirmation before a saved target changes", () => {
    assert.match(source, /case "target"/);
    assert.match(source, /Change sync destination/);
    assert.match(source, /Confirm destination/);
    assert.match(source, /sync.connectGitHubSyncRepository/);
  });
  it("creates new branches as reviewed drafts while pull only chooses existing sources", () => {
    assert.match(source, /setup.direction === "push"/);
    assert.match(source, /Create new branch/);
    assert.match(source, /newBranch: creating/);
    assert.match(source, /Source branch/);
    assert.match(source, /Created only when you confirm publication/);
  });
});
