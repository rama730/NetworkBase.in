import assert from "node:assert/strict";
import { test } from "node:test";

import { profileUpdateSchema } from "../../src/lib/validations/profile";

const check = (website?: string) => profileUpdateSchema.safeParse({ website });

// VALID-004: an invalid website is an error; only an explicit empty value clears the field.
test("unsupported or unsafe websites are rejected, never turned into a clear", () => {
  for (const bad of ["mailto:a@b.co", "ftp://example.com", "javascript:alert(1)", "data:text/html,x", "http://localhost", "https://", "not a url at all"]) {
    assert.equal(check(bad).success, false, bad);
  }
});

test("valid websites pass and normalize; an empty value is an explicit clear", () => {
  for (const good of ["example.com", "https://example.com/path?q=1", "http://example.com", "sub.example.co.uk"]) {
    assert.equal(check(good).success, true, good);
  }
  assert.equal(check("").success, true);
  assert.equal(check("   ").success, true);
  assert.equal(check(undefined).success, true);
});
