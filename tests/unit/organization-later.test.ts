import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { weeklyRepeats } from "@/lib/organizations/assignment-rules";

// Report §33.5 "Later": Repeat assignment's titles and dates. The calendar feed is tested with the database.

test("Repeat weekly: numbered titles count on, others say the week; never past the date, never more than 26", () => {
  const due = new Date("2026-11-06T18:29:00Z");
  const weeks = weeklyRepeats("Lab 1", due, new Date("2026-11-27T18:29:00Z"));
  assert.deepEqual(weeks.map((w) => [w.title, w.dueDate.toISOString()]), [
    ["Lab 2", "2026-11-13T18:29:00.000Z"], ["Lab 3", "2026-11-20T18:29:00.000Z"], ["Lab 4", "2026-11-27T18:29:00.000Z"],
  ]);
  assert.deepEqual(weeklyRepeats("Reading", due, new Date("2026-11-14T00:00:00Z")).map((w) => w.title), ["Reading · week 2"]);
  assert.equal(weeklyRepeats("Lab 1", due, new Date("2027-12-31T00:00:00Z")).length, 26);
  assert.deepEqual(weeklyRepeats("Lab 1", due, due), []);
});

test("no browser pop-up is left anywhere in the app; the shared dialog asks instead (report §32.3, decision 75)", () => {
  const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" }).split("\n").filter((f) => /\.(tsx?|jsx?)$/.test(f));
  const found = files.filter((f) => /\bwindow\.(confirm|prompt|alert)\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(found, []);
});
