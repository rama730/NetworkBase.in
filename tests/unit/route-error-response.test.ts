import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { routeErrorResponse } from "../../src/app/api/v1/_error";
import { ConflictError, ForbiddenError, NotFoundError } from "../../src/lib/errors/domain";

const ctx = { requestId: "req-1", scope: "test", fallback: "Failed to do the thing" };

// API-005: authorization and conflict outcomes keep their meaning; internal detail never reaches clients.
test("domain errors keep their status and safe message", async () => {
  for (const [error, status, code] of [
    [new ForbiddenError("Forbidden"), 403, "FORBIDDEN"],
    [new NotFoundError("Project not found"), 404, "NOT_FOUND"],
    [new ConflictError("File has an active editing lease"), 409, "CONFLICT"],
  ] as const) {
    const response = routeErrorResponse(error, ctx);
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.errorCode, code);
    assert.equal(body.message, error.message);
  }
});

test("tab and file access failures are typed domain errors", () => {
  assert.match(readFileSync("src/lib/data/project-access.ts", "utf8"), /class ProjectTabForbiddenError extends ForbiddenError/);
  const helpers = readFileSync("src/lib/files/internal-helpers.ts", "utf8");
  assert.doesNotMatch(helpers, /new Error\("(Forbidden|Project not found|File not found|Task not found)"\)/);
});

test("any other error becomes an opaque 500 carrying only the request id", async () => {
  const response = routeErrorResponse(new Error('duplicate key value violates unique constraint "project_nodes_pkey" (secret=abc)'), ctx);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.message, "Failed to do the thing");
  assert.deepEqual(body.details, { requestId: "req-1" });
  assert.doesNotMatch(JSON.stringify(body), /project_nodes_pkey|secret/);
});

test("extension routes answer failures through the shared mapper", () => {
  for (const route of ["task-push", "task-detail", "bulk-intent", "bulk-finalize"]) {
    const source = readFileSync(`src/app/api/v1/extension/${route}/route.ts`, "utf8");
    assert.match(source, /routeErrorResponse\(error,/, route);
    assert.doesNotMatch(source, /jsonError\(\s*error/, route);
  }
});
