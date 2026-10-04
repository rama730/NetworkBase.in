import assert from "node:assert/strict";
import test from "node:test";

import {
  boundPersonCardItems,
  MAX_MOUNTED_PERSON_CARDS,
  MAX_RETAINED_PERSON_QUERY_PAGES,
} from "@/lib/network/person-card-bounds";

test("person card bounds retain the newest 500 items across ten query pages", () => {
  const people = Array.from({ length: 10_000 }, (_, id) => ({ id }));
  const bounded = boundPersonCardItems(people);
  assert.equal(MAX_MOUNTED_PERSON_CARDS, 500);
  assert.equal(MAX_RETAINED_PERSON_QUERY_PAGES, 10);
  assert.equal(bounded.length, 500);
  assert.equal(bounded[0]?.id, 9_500);
  assert.equal(bounded.at(-1)?.id, 9_999);
});
