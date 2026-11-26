import assert from "node:assert/strict";
import { test } from "node:test";

import { canRsvp, communityEventSchema, eventProblem, eventState, placeFor, placesLeft } from "../../src/lib/organizations/community-events";

const f = { kind: "community" as const, start: "2026-12-04T13:30:00Z", end: "2026-12-04T16:00:00Z", format: "in_person" as const, place: "HSR Layout", who: "members" as const, hosts: [], runOfShow: [] };

test("34.4 fields: ends after it starts; in person needs a place; online doesn't", () => {
  assert.ok(communityEventSchema.safeParse(f).success);
  assert.equal(eventProblem(f), null);
  assert.match(String(eventProblem({ ...f, end: f.start })), /ends after/);
  assert.match(String(eventProblem({ ...f, place: " " })), /where/);
  assert.equal(eventProblem({ ...f, format: "online", place: null }), null);
  assert.equal(communityEventSchema.safeParse({ ...f, link: "https://x" }).success, false, "the link never rides in the item's fields");
});

test("34.4 call 3: Going while places last, then the waitlist; no limit means always Going", () => {
  assert.equal(placeFor(2, 1), "going");
  assert.equal(placeFor(2, 2), "waitlisted");
  assert.equal(placeFor(null, 500), "going");
  assert.equal(placesLeft(2, 3), 0, "a lowered limit never goes negative");
  assert.equal(placesLeft(null, 3), null);
});

test("34.4 states: Published, Full, Happening now, Ended, Cancelled; ended and cancelled take no RSVPs", () => {
  const before = new Date("2026-12-01T00:00:00Z");
  assert.equal(eventState(f, false, null, 10, before), "published");
  assert.equal(eventState(f, false, 10, 10, before), "full");
  assert.equal(eventState(f, false, null, 0, new Date("2026-12-04T14:00:00Z")), "happening");
  assert.equal(eventState(f, false, null, 0, new Date("2026-12-05T00:00:00Z")), "ended");
  assert.equal(eventState(f, true, null, 0, before), "cancelled");
  assert.equal(canRsvp("full"), true);
  assert.equal(canRsvp("ended"), false);
  assert.equal(canRsvp("cancelled"), false);
});
