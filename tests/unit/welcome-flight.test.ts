import assert from "node:assert/strict";
import test from "node:test";

import { announcesPresence, avatarFontSize, centerBox, flightTimings, landingBox, WELCOME_FLIGHT_EVENT_TYPES } from "../../src/lib/onboarding/welcome-flight";

test("presence is announced only when it is true", () => {
  assert.equal(announcesPresence("public"), true);
  assert.equal(announcesPresence("connections"), true);
  assert.equal(announcesPresence("private"), false);
});

test("the whole flight is about five seconds, and half that with reduced motion", () => {
  const sum = (t: ReturnType<typeof flightTimings>) => t.stepForward + t.presenceHold + t.welcomeHold + t.fly;
  const full = flightTimings(false);
  assert.ok(sum(full) >= 4000 && sum(full) <= 5000, `full flight is ${sum(full)}ms`);
  assert.ok(sum(flightTimings(true)) <= sum(full) / 2 + 2);
  assert.ok(full.max > sum(full) + full.slotWait, "the watchdog outlasts the story and the wait for the page");
});

test("desktop: the photo rests at the same place as the design, with the lines below", () => {
  const { box, captionTop, phone } = centerBox({ width: 1280, height: 800 });
  assert.equal(phone, false);
  assert.deepEqual(box, { left: 576, top: 262, width: 128, height: 128 });
  assert.equal(captionTop, 446);
});

test("phone: smaller photo, tighter lines, centred on the width", () => {
  const { box, phone } = centerBox({ width: 390, height: 844 });
  assert.equal(phone, true);
  assert.equal(box.width, 112);
  assert.equal(box.left, 139);
  assert.equal(centerBox({ width: 768, height: 900 }).phone, false, "768px is the first desktop width");
});

test("the photo lands exactly in the avatar slot, or tucks into the middle of the menu button", () => {
  const slot = { left: 1224, top: 12, width: 32, height: 32 };
  assert.deepEqual(landingBox(slot, "avatar"), slot);
  assert.deepEqual(landingBox({ left: 8, top: 6, width: 44, height: 44 }, "menu"), { left: 16, top: 14, width: 28, height: 28 });
});

test("initials follow the sizes the app already uses", () => {
  assert.deepEqual([32, 64, 128, 112].map(avatarFontSize), [14, 15, 32, 28]);
});

test("the three events are the ones the page records", () => {
  assert.deepEqual([...WELCOME_FLIGHT_EVENT_TYPES], ["welcome_flight_started", "welcome_flight_completed", "welcome_flight_skipped"]);
});
