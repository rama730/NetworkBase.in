import assert from "node:assert/strict";
import { test } from "node:test";

// Report 38.7 T4 part 7 (plan A2.4): request types, answers and the views' order.
test("starterTypes: General request and Design request with the report's questions and times", async () => {
  const { starterTypes } = await import("../../src/lib/workflows/requests");
  const [general, design] = starterTypes();
  assert.deepEqual([general!.name, general!.questions.map((q) => `${q.label}${q.required ? "*" : ""}`), general!.firstReplyMinutes], ["General request", ["What do you need?*", "Why now?"], 240]);
  assert.deepEqual([design!.name, design!.questions.map((q) => q.kind), design!.firstReplyMinutes, design!.deliverMinutes], ["Design request", ["choice", "text", "long_text", "file"], 480, 2400]);
  assert.deepEqual(design!.questions[0]!.options, ["Social graphic", "Banner", "Deck", "Video edit", "Other"]);
  assert.notEqual(general!.id, design!.id);
});

test("requestTypeSchema: up to 5 questions, choices need 2–12 options, names up to 40", async () => {
  const { requestTypeSchema, starterTypes } = await import("../../src/lib/workflows/requests");
  const base = starterTypes()[0]!;
  assert.equal(requestTypeSchema.safeParse(base).success, true);
  const q = (i: number) => ({ id: `q${i}`, label: `Q${i}`, kind: "text", required: false });
  assert.equal(requestTypeSchema.safeParse({ ...base, questions: [1, 2, 3, 4, 5, 6].map(q) }).success, false, "6 questions refused");
  assert.equal(requestTypeSchema.safeParse({ ...base, questions: [{ ...q(1), kind: "choice", options: ["Only"] }] }).success, false);
  assert.equal(requestTypeSchema.safeParse({ ...base, name: "x".repeat(41) }).success, false);
  assert.equal(requestTypeSchema.safeParse({ ...base, firstReplyMinutes: null, deliverMinutes: null }).success, true, "Off is allowed");
});

test("validateAnswers: required, choice options, dates, files; past dates allowed", async () => {
  const { validateAnswers, starterTypes } = await import("../../src/lib/workflows/requests");
  const [general, design] = starterTypes();
  const g = general!.questions, d = design!.questions;
  assert.equal(validateAnswers(general!, {}), "Answer “What do you need?”");
  assert.equal(validateAnswers(general!, { [g[0]!.id]: "  " }), "Answer “What do you need?”");
  assert.equal(validateAnswers(general!, { [g[0]!.id]: "A logo" }), null);
  assert.equal(validateAnswers(design!, { [d[0]!.id]: "Poster", [d[2]!.id]: "Brief" }), "Pick one of the options for “What’s needed”");
  assert.equal(validateAnswers(design!, { [d[0]!.id]: "Banner", [d[2]!.id]: "Brief", [d[3]!.id]: ["not-a-uuid"] }), "Check the files for “Assets to use”");
  assert.equal(validateAnswers(design!, { [d[0]!.id]: "Banner", [d[2]!.id]: "Brief", [d[3]!.id]: ["5f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f"] }), null);
  assert.equal(validateAnswers(design!, { [d[0]!.id]: "Banner", [d[2]!.id]: "Brief", zzz: "x" }), "There’s no question “zzz” in Design request");
  const dated = { ...general!, questions: [{ id: "when", label: "When", kind: "date" as const, required: true }] };
  assert.equal(validateAnswers(dated, { when: "2020-01-01" }), null, "a past date is allowed");
  assert.equal(validateAnswers(dated, { when: "soon" }), "Pick a date for “When”");
});

test("workingTime and requestFooter: hours below a day, days at whole days, Off left out", async () => {
  const { workingTime, requestFooter, starterTypes } = await import("../../src/lib/workflows/requests");
  assert.deepEqual([workingTime(240), workingTime(60), workingTime(480), workingTime(2400), workingTime(600)], ["4 working hours", "1 working hour", "1 working day", "5 working days", "10 working hours"]);
  const [general, design] = starterTypes();
  assert.equal(requestFooter(general!), "first reply within 4 working hours");
  assert.equal(requestFooter(design!), "first reply within 1 working day · deliver within 5 working days");
  assert.equal(requestFooter({ ...general!, firstReplyMinutes: null }), "");
});

test("activeTypes and inboxOrder: archived types leave the ask form; New requests oldest first", async () => {
  const { activeTypes, inboxOrder, starterTypes } = await import("../../src/lib/workflows/requests");
  const [a, b] = starterTypes();
  assert.deepEqual(activeTypes([{ ...a!, archivedAt: "2026-11-01T00:00:00.000Z" }, b!]).map((t) => t.name), ["Design request"]);
  const r = (id: string, stage: string, createdAt: string) => ({ id, stage, createdAt });
  assert.deepEqual(inboxOrder([r("1", "new", "2026-11-22T10:00:00Z"), r("2", "accepted", "2026-11-20T10:00:00Z"), r("3", "new", "2026-11-21T10:00:00Z")]).map((x) => x.id), ["3", "1"]);
});
