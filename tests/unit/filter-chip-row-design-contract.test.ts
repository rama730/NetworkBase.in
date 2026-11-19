import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Report 38.4 part 10 (plan A0.11): the chip row's design contract: our badge shape (no round pills), the order
// Assigned to · Type · Due, + Filter for the rest, Clear all from two set chips, and the address keeps the filters.
const row = readFileSync("src/components/ui/FilterChipRow.tsx", "utf8");
const tab = readFileSync("src/components/workspaces/v2/TasksTab.tsx", "utf8");

test("chips use the 5 px badge shape and the shared menu parts, never round pills", () => {
  assert.match(row, /rounded-\[5px\]/);
  assert.doesNotMatch(row, /rounded-full/);
  assert.match(row, /DropdownMenuCheckboxItem/);
  assert.match(row, /presentation="bottom-sheet"/, "phones get one Filters sheet (W9)");
});

test("Tasks: Assigned to, Type, Due in order; Priority and Sprint behind + Filter; Clear all from two", () => {
  const order = ["\"Assigned to\"", "\"Type\"", "\"Due\"", "\"Priority\"", "\"Sprint\""].map((n) => tab.indexOf(`name: ${n}`));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1]!)), JSON.stringify(order));
  assert.match(tab, /key: "priority", name: "Priority", multi: true, extra: true/);
  assert.match(row, /set\.length >= 2 \? <button[^>]*>Clear all/);
  assert.match(tab, /useUrlMirror\(filtersToUrl\(chipFilters\)\)/);
});
