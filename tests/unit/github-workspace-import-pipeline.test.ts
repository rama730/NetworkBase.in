import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { projectActionsSource } from "./_workspace-actions-source";

const PROJECT_ACTIONS_SRC = projectActionsSource();

const PROJECT_IMPORT_FUNCTION_SRC = readFileSync(
  path.resolve(__dirname, "../../src/inngest/functions/workspace-import.ts"),
  "utf8",
);

const IMPORT_UTILS_SRC = readFileSync(
  path.resolve(__dirname, "../../src/lib/import/utils.ts"),
  "utf8",
);

test("GitHub project import enqueue has a local inline fallback", () => {
  assert.match(
    PROJECT_ACTIONS_SRC,
    /import\s*\{\s*runGithubProjectImport\s*\}\s*from\s*['"]@\/lib\/github\/workspace-import-runner['"]/,
    "project actions must import the shared GitHub import runner",
  );
  assert.match(
    PROJECT_ACTIONS_SRC,
    /function\s+shouldRunGithubImportInlineFallback/,
    "project actions must decide when queue failures can fall back to inline import",
  );
  assert.match(
    PROJECT_ACTIONS_SRC,
    /GITHUB_IMPORT_INLINE_FALLBACK/,
    "the inline fallback must be explicitly configurable",
  );
  assert.match(
    PROJECT_ACTIONS_SRC,
    /runGithubProjectImport\s*\(/,
    "queue failure fallback must execute the shared import runner",
  );

  const dispatchCallCount =
    PROJECT_ACTIONS_SRC.match(/enqueueGithubImportOrRunInline\s*\(/g)?.length ??
    0;
  assert.equal(
    dispatchCallCount,
    2,
    "the helper definition plus the create call site must use the same dispatch path",
  );
});

test("Inngest project import function delegates to the shared runner", () => {
  assert.match(
    PROJECT_IMPORT_FUNCTION_SRC,
    /runGithubProjectImport/,
    "Inngest project import must use the same runner as inline fallback",
  );
});
