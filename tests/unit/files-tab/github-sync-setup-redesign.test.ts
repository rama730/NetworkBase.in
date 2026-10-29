import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("Approved compact GitHub Sync setup", () => {
  const source = readFileSync(
    "src/components/workspaces/v2/files-tab/RepositorySync.tsx",
    "utf8",
  );
  const css = readFileSync(
    "src/components/workspaces/v2/files-tab/github-sync/RepositorySync.module.css",
    "utf8",
  );
  it("uses one heading, a back arrow and compact mode choices", () => {
    assert.match(source, /title="Repository setup"/);
    assert.match(source, /Repository setup mode/);
    assert.match(source, />\s*Create new\s*</);
    assert.match(source, />\s*Connect existing\s*</);
    assert.doesNotMatch(source, /Pull unavailable|Back to Overview/);
  });
  it("keeps fields flat and responsive rather than oversized transfer cards", () => {
    assert.match(source, /className=\{styles.fields\}/);
    assert.match(source, /<legend>Transfer direction<\/legend>/);
    assert.match(css, /@container sync \(max-width:\s*640px\)/);
    assert.doesNotMatch(source, /bg-\[#|shadow-xl|tracking-wider/);
  });
  it("compares without saving a target or starting publication", () => {
    const compare = source.slice(
      source.indexOf("async function compare("),
      source.indexOf("const compareRef"),
    );
    assert.match(compare, /sync.compareGitHubSync/);
    assert.doesNotMatch(
      compare,
      /connectGitHubSyncRepository|executeGitHubSync/,
    );
    assert.match(source, /No files change during comparison/);
  });
});
