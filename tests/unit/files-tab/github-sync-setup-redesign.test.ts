import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("GitHub Sync Setup Workbench Redesign Contract", () => {
  const workspacePath = path.resolve(
    process.cwd(),
    "src/components/projects/v2/files-tab/GitHubSyncWorkspace.tsx",
  );
  const source = readFileSync(workspacePath, "utf-8");

  it("omits the redundant header, icon, and marketing tagline", () => {
    // Redundant header with tagline must be removed
    assert.doesNotMatch(
      source,
      /Review,\s*publish,\s*and\s*bring\s*changes\s*back/,
      "Marketing tagline must be omitted from view",
    );
    assert.doesNotMatch(
      source,
      /<h2[^>]*>\s*<Github[^>]*\/>\s*GitHub\s*Sync\s*<\/h2>/,
      "Redundant GitHub Sync h2 header must be omitted",
    );
  });

  it("eliminates hover cards and immediately renders setup workbench", () => {
    // The setupMode === null hover card container must be completely gone
    assert.doesNotMatch(
      source,
      /setupMode\s*===\s*null/,
      "Must not have setupMode === null condition for hover cards",
    );

    // Initial state defaults to create mode
    assert.match(
      source,
      /const\s*\[newRepo,\s*setNewRepo\]\s*=\s*useState\(true\);/,
      "newRepo must default to true",
    );
    assert.match(
      source,
      /const\s*\[setupMode,\s*setSetupMode\]\s*=\s*useState<"create"\s*\|\s*"existing">\("create"\);/,
      "setupMode must default to 'create'",
    );
  });

  it("provides inline segmented switcher for Create repository and Connect existing repository", () => {
    assert.match(
      source,
      /Create repository/,
      "Must have Create repository segment",
    );
    assert.match(
      source,
      /Connect existing repository/,
      "Must have Connect existing repository segment",
    );
    assert.match(
      source,
      /bg-\[#D14E24\]\s*text-white/,
      "Active toggle must use NetworkBase primary color #D14E24",
    );
  });

  it("removes disabled pull card for new repositories and uses flat drafting layout", () => {
    // Must NOT have disabled Pull unavailable card
    assert.doesNotMatch(
      source,
      /Pull unavailable/,
      "Disabled 'Pull unavailable' card must be removed",
    );

    // Must use flat 2-column grid without nested sub-card bloat
    assert.match(
      source,
      /grid\s*gap-4\s*sm:grid-cols-2\s*border-t\s*border-\[#E8E3D9\]/,
      "Must use flat 2-column layout with warm divider",
    );
  });

  it("leads into reviewed staging rather than publishing immediately", () => {
    assert.match(
      source,
      /Review changes/,
      "Setup must lead into review before any publication action",
    );
  });
});
