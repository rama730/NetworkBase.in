import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { laterTimes } from "@/lib/messaging/reminders";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("#10 one list of later times: reminders and scheduling share labels, no duplicate on Sundays", () => {
  const wednesday = new Date(2026, 9, 7, 14, 0); // Wed Oct 7, 2:00 PM
  const remind = laterTimes("remind", wednesday);
  assert.deepEqual(remind.map((t) => t.label.replace(/9:00\s?AM/, "9:00 AM")), ["In 20 minutes", "In 1 hour", "In 3 hours", "Tomorrow at 9:00 AM", "Monday at 9:00 AM"]);
  assert.equal(remind[3]!.at().getDate(), 8);
  assert.equal(remind[4]!.at().getDay(), 1);
  const schedule = laterTimes("schedule", wednesday);
  assert.deepEqual(schedule.map((t) => t.label), [remind[1]!.label, remind[3]!.label, remind[4]!.label]);

  const sunday = new Date(2026, 9, 11, 14, 0); // Sun Oct 11: Monday is tomorrow
  assert.equal(laterTimes("remind", sunday).filter((t) => t.label.startsWith("Monday")).length, 0);
  assert.equal(laterTimes("schedule", sunday).length, 2);

  for (const file of ["src/components/messages/MessageRow.tsx", "src/components/messages/MessagesViews.tsx", "src/components/messages/Composer.tsx"]) {
    assert.match(read(file), /laterTimes\(/, `${file} uses the shared list`);
  }
});
