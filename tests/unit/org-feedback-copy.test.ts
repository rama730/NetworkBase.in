import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { FEEDBACK_COPY } from "@/lib/feedback/copy";

// Found live (B2.5a): error toasts show only catalog messages; anything else reads "Action couldn’t finish". Every
// message the organization actions return or throw must be in the catalog, so people see the real reason.
const ACTIONS = ["attendance", "capstone", "demo-day", "school-year", "school-events", "school-calendar", "curriculum-map", "curriculum", "plan-hand-in", "staff-hand-ins", "school-timetable", "school-cover", "school-duties", "staff-growth", "staff-observations", "org-docs", "company", "company-people", "company-goals", "class-home", "cohort-completion", "cohort-move", "exams", "institutions", "learning-path", "literature", "marks",
  "mentoring-plan", "mentoring", "mocks", "my-week", "peer-review", "prep", "programs", "sections", "term-plan", "thesis-coordinator"];

test("organization actions' messages are all in the feedback catalog", () => {
  const files = readdirSync("src/app/actions").map((f) => f.replace(/\.ts$/, ""));
  const keys = new Set(Object.keys(FEEDBACK_COPY));
  const missing: string[] = [];
  for (const name of ACTIONS) {
    assert.ok(files.includes(name), `${name}.ts exists`);
    const source = readFileSync(`src/app/actions/${name}.ts`, "utf8");
    for (const m of source.matchAll(/(?:error:\s*|new Error\()(["`])((?:(?!\1).)+)\1/g)) {
      let n = 0;
      const text = (m[1] === "`" ? m[2]!.replace(/\$\{[^}]+\}/g, () => `{v${++n}}`) : m[2]!).replace(/'/g, "’");
      if (text === "error" || text.length < 4 || text.startsWith("{")) continue;
      if (!keys.has(text)) missing.push(`${name}: ${text}`);
    }
  }
  // Rules that return a reason the actions pass on.
  for (const text of ["Give the card a title.", "It’s Ready once every milestone, the Final one too, is done.", "Say why they completed without meeting the rule.", "Say why they didn’t complete."]) {
    if (!keys.has(text)) missing.push(`rules: ${text}`);
  }
  assert.deepEqual(missing, []);
});
