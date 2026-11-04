import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripOsJunkFiles } from "../../src/lib/files/upload-validator";
import { isToolOutputPath, shouldIgnorePath } from "../../src/lib/import/import-filters";

function fileAt(rel: string): File {
  const f = new File(["x"], rel.split("/").pop()!);
  Object.defineProperty(f, "webkitRelativePath", { value: rel });
  return f;
}

describe("tool output is never uploaded", () => {
  it("drops regenerable tool folders from browser folder uploads, at any depth and any case", () => {
    const kept = stripOsJunkFiles([
      fileAt("proj/src/app.ts"),
      fileAt("proj/codeql-db/db-javascript/default/strings.rel"),
      fileAt("proj/Node_Modules/react/index.js"),
      fileAt("proj/.git/objects/pack/a.pack"),
      fileAt("proj/.venv/lib/site.py"),
      fileAt("proj/api/__pycache__/x.pyc"),
    ]).map((f) => f.webkitRelativePath);
    assert.deepEqual(kept, ["proj/src/app.ts"]);
  });

  it("keeps folders a student may mean to share in browser uploads", () => {
    const paths = ["p/build/report.pdf", "p/logs/notes.txt", "p/.vscode/settings.json", "p/.github/workflows/ci.yml", "p/dist/readme.md"];
    assert.deepEqual(stripOsJunkFiles(paths.map(fileAt)).map((f) => f.webkitRelativePath), paths);
  });

  it("only matches whole folder names", () => {
    assert.equal(isToolOutputPath("p/my-node_modules-notes/a.md"), false);
    assert.equal(isToolOutputPath("p/codeql-db.md"), false);
    assert.equal(isToolOutputPath("/codeql-db/results/x.bqrs"), true);
  });

  it("GitHub import ignores every tool output folder too", () => {
    for (const p of ["codeql-db/a.rel", "x/.venv/a.py", "x/.codeql/a"]) assert.equal(shouldIgnorePath(p), true, p);
  });
});
