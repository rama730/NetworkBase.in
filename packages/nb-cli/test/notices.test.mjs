import { it } from "node:test";
import assert from "node:assert/strict";
import { newer } from "../lib/print/notices.mjs";

it("update notice compares versions, pre-releases before releases", () => {
  assert.equal(newer("2.1.0", "2.0.9"), true);
  assert.equal(newer("2.0.0", "2.0.0-next.1"), true);
  assert.equal(newer("1.0.4", "2.0.0-next.1"), false);
  assert.equal(newer("2.0.0", "2.0.0"), false);
  assert.equal(newer("10.0.0", "9.9.9"), true);
});
