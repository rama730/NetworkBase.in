import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { jsonSuccessConditional } from "../../src/app/api/v1/_conditional";

const get = (ifNoneMatch?: string) =>
  new Request("https://x.test/api", { headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {} });

// API-007: the validator is derived from the representation, never from a subset of it.
test("a 304 only stands for the exact representation", async () => {
  const first = jsonSuccessConditional(get(), { tasks: [{ id: "a", filesCount: 1 }], hasMore: false });
  const etag = first.headers.get("etag")!;
  assert.match(etag, /^W\/"/);
  assert.equal(first.status, 200);

  assert.equal(jsonSuccessConditional(get(etag), { tasks: [{ id: "a", filesCount: 1 }], hasMore: false }).status, 304);
  assert.equal(jsonSuccessConditional(get(`"other", ${etag}`), { tasks: [{ id: "a", filesCount: 1 }], hasMore: false }).status, 304);
  // Anything that changes the payload changes the validator: file count, page size, next cursor.
  for (const changed of [
    { tasks: [{ id: "a", filesCount: 2 }], hasMore: false },
    { tasks: [], hasMore: false },
    { tasks: [{ id: "a", filesCount: 1 }], hasMore: true },
  ]) {
    const response = jsonSuccessConditional(get(etag), changed);
    assert.equal(response.status, 200);
    assert.notEqual(response.headers.get("etag"), etag);
  }
});

test("conditional routes use the shared helper instead of hand-built validators", () => {
  for (const route of [
    "src/app/api/v1/extension/project-tasks/route.ts",
    "src/app/api/v1/extension/project-summary/route.ts",
    "src/app/api/v1/projects/[id]/capabilities/route.ts",
  ]) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /jsonSuccessConditional\(/, route);
    assert.doesNotMatch(source, /const etag =|ETag:/, route);
  }
});
