import assert from "node:assert/strict";
import test from "node:test";

import { applicationLineKind, normalizeApplicationLine } from "../../src/lib/messaging/application-status";
import { notifiesEveryMessage, notifyChoices } from "../../src/lib/messaging/channel-view";

test("status lines get their verb, old wording is read as the new one", () => {
  assert.equal(applicationLineKind("accepted this application: welcome!"), "accepted");
  assert.equal(applicationLineKind("declined this application"), "declined");
  assert.equal(applicationLineKind("withdrew this application"), "withdrew");
  assert.equal(applicationLineKind("applied again"), "applied");
  assert.equal(applicationLineKind("edited the application and changed the role"), "edited");
  assert.equal(applicationLineKind("closed this application: the role was filled."), "closed");
  assert.equal(applicationLineKind("joined #general"), null, "an ordinary system line is not an application line");
  assert.equal(normalizeApplicationLine("Application reopened for review."), "reopened this application");
  assert.equal(applicationLineKind("Application reopened for review."), "reopened");
  assert.equal(normalizeApplicationLine("reapplied"), "applied again");
  assert.equal(normalizeApplicationLine("Application withdrawn by applicant"), "withdrew this application");
});

test("an application thread notifies every message and offers the matching choices", () => {
  const thread = { kind: "private", project_id: "p1", application_id: "a1" };
  assert.equal(notifiesEveryMessage(thread), true);
  assert.deepEqual(notifyChoices(thread).map((c) => c.value), ["all", "mentions", "mute"]);
  assert.equal(notifiesEveryMessage({ kind: "private", project_id: "p1", application_id: null }), false, "a project channel still notifies on mentions");
});
