import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeUploadedFolder } from "../../src/lib/upload/analyze-folder";

const make = (path: string, content: string) => {
  const file = new File([content], path.split("/").pop()!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
};
const list = (...files: File[]) => Object.assign(files, { item: (i: number) => files[i] ?? null }) as unknown as FileList;
const pkg = (name: string, description: string) => JSON.stringify({ name, description });

// API-021
test("the folder's own root package.json and README win over nested ones, in any listing order", async () => {
  const files = [
    make("app/packages/web/package.json", pkg("nested-web", "nested description")),
    make("app/package.json", pkg("root-app", "root description")),
    make("app/examples/demo/README.md", "# demo\nnested readme text"),
    make("app/README.md", "# app\nroot readme text"),
  ];
  for (const order of [files, [...files].reverse()]) {
    const result = await analyzeUploadedFolder(list(...order));
    assert.equal(result.title, "Root App");
    assert.equal(result.description, "root description");
  }
  const readmeOnly = await analyzeUploadedFolder(list(files[2]!, files[3]!));
  assert.equal(readmeOnly.description, "root readme text");
});

test("dependency and build directories are never the source of metadata", async () => {
  const result = await analyzeUploadedFolder(list(
    make("app/node_modules/left-pad/package.json", pkg("left-pad", "pad strings")),
    make("app/dist/README.md", "# dist\nbuilt output"),
    make("app/src/nested/package.json", pkg("inner", "inner description")),
  ));
  assert.equal(result.title, "Inner");
  assert.equal(result.description, "inner description");
});

test("equal depth resolves deterministically by path", async () => {
  const a = make("app/a/package.json", pkg("alpha", "alpha"));
  const b = make("app/b/package.json", pkg("beta", "beta"));
  assert.equal((await analyzeUploadedFolder(list(b, a))).title, "Alpha");
  assert.equal((await analyzeUploadedFolder(list(a, b))).title, "Alpha");
});
