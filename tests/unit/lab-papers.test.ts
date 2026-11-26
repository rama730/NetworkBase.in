import assert from "node:assert/strict";
import { test } from "node:test";

import { allConfirmed, authorLine, authorListKey, isPublicPaper, moveProblem, type PaperFields } from "../../src/lib/organizations/lab-papers";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const base = (over: Partial<PaperFields> = {}): PaperFields => ({ kind: "paper", venue: "", deadline: null, link: "", doi: "", private: false, preprintPublic: false,
  authors: [{ userId: A }, { name: "Outside Author" }, { userId: B }], confirmed: {}, history: [], review: null, ...over });

test("35.3 call 5: Submitted waits for every member author to confirm this exact list; outside names never confirm", () => {
  const key = authorListKey(base().authors);
  assert.equal(allConfirmed(base({ confirmed: { [A]: key } })), false);
  assert.equal(allConfirmed(base({ confirmed: { [A]: key, [B]: key } })), true);
  const reordered = base({ authors: [{ userId: B }, { userId: A }, { name: "Outside Author" }], confirmed: { [A]: key, [B]: key } });
  assert.equal(allConfirmed(reordered), false, "a new order asks again");
});

test("call 3 + 6: stage moves; internal review before submitting a paper; rejected goes back via history", () => {
  const key = authorListKey(base().authors);
  const ready = base({ confirmed: { [A]: key, [B]: key } });
  assert.match(String(moveProblem(ready, "drafting", "submitted", true)), /internal review/);
  assert.equal(moveProblem({ ...ready, review: { approvedBy: A, at: "x", listKey: key } }, "drafting", "submitted", true), null);
  assert.equal(moveProblem(ready, "drafting", "submitted", false), null, "a lab can switch internal review off");
  assert.equal(moveProblem(base({ kind: "talk", confirmed: { [A]: key, [B]: key } }), "drafting", "submitted", true), null, "talks skip internal review");
  assert.match(String(moveProblem(base(), "drafting", "submitted", false)), /confirms/);
  assert.equal(moveProblem(ready, "submitted", "rejected", true), null);
  assert.match(String(moveProblem(ready, "idea", "published", true)), /can’t go/);
  assert.match(String(moveProblem(base(), "revising", "submitted", true)), /confirms/, "a resubmission still needs the current list confirmed");
  assert.equal(moveProblem({ ...ready, review: { approvedBy: A, at: "x", listKey: key, kind: "paper" } }, "revising", "submitted", true), null, "…and the approval still holds when nothing changed");
  assert.match(String(moveProblem(ready, "revising", "submitted", true)), /internal review/, "changed since the approval: the PI looks again");
  assert.match(String(moveProblem({ ...ready, kind: "paper", review: { approvedBy: A, at: "x", listKey: key, kind: "preprint" } }, "drafting", "submitted", true)), /internal review/, "an approval binds to its kind");
});

test("call 8: only Published, or a marked preprint, and never private, goes public", () => {
  assert.equal(isPublicPaper("published", { kind: "paper", private: false, preprintPublic: false }), true);
  assert.equal(isPublicPaper("submitted", { kind: "paper", private: false, preprintPublic: true }), false);
  assert.equal(isPublicPaper("drafting", { kind: "preprint", private: false, preprintPublic: true }), true);
  assert.equal(isPublicPaper("published", { kind: "paper", private: true, preprintPublic: false }), false);
  assert.equal(authorLine([{ userId: A }, { name: "X" }, { userId: B }], new Map([[A, "Dr. Rao"], [B, "Mei"]])), "Dr. Rao, X and Mei");
});
