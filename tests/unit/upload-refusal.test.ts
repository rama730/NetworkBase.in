import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeAndValidateMimeType, uploadRefusal } from "../../src/lib/upload/security";

test("a refused file type becomes words for the person; other errors stay server errors", () => {
  let caught: unknown = null;
  try { normalizeAndValidateMimeType("image/svg+xml"); } catch (error) { caught = error; }
  assert.match(uploadRefusal(caught) ?? "", /can’t be uploaded/);
  assert.match(uploadRefusal(new Error("Unsupported MIME type")) ?? "", /can’t be uploaded/);
  assert.equal(uploadRefusal(new Error("connection reset")), null);
  assert.equal(uploadRefusal("x"), null);
});
