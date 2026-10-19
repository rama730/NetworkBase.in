import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { test } from "node:test";

// MAINT-003: the current runbook only names scripts and files that exist. Archived pages carry a banner instead.
const CURRENT_DOCS = ["README.md"];
const scripts = new Set(Object.keys((JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts));

for (const doc of CURRENT_DOCS.filter(existsSync)) {
  const text = readFileSync(doc, "utf8");
  test(`${doc} names only npm scripts that exist`, () => {
    const missing = [...text.matchAll(/npm run(?: -s)? ([\w:.-]+)/g)].map((m) => m[1]!).filter((name) => !scripts.has(name));
    assert.deepEqual(missing, []);
  });
  test(`${doc} links only to files that exist`, () => {
    const missing = [...text.matchAll(/\]\(((?!https?:|#|mailto:)[^)#\s]+)/g)]
      .map((m) => m[1]!)
      .filter((link) => !existsSync(normalize(join(dirname(doc), link))));
    assert.deepEqual(missing, []);
  });
}

test("the stability runbook is marked archived", () => {
  assert.match(readFileSync("docs/stability-rollout-runbook.md", "utf8"), /^> \*\*Archived/);
});
