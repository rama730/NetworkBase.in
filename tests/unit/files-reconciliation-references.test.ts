import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// COR-020: an object is an orphan only when nothing references it, and the checkpoint never skips a partly reported project.
test("reconciliation treats retained revisions and registered assets as live references", () => {
  const source = readFileSync("src/inngest/functions/project-files-reconciliation.ts", "utf8");
  assert.match(source, /NOT EXISTS \(SELECT 1 FROM file_versions fv WHERE fv\.s3_key = objects\.name\)/);
  assert.match(source, /FROM storage_assets sa[\s\S]*sa\.state IN \('pending', 'verified', 'delete_pending', 'deleting'\)/);
});

test("the heartbeat checkpoint only moves past fully examined projects", () => {
  const source = readFileSync("src/inngest/functions/project-files-reconciliation.ts", "utf8");
  assert.match(source, /let checkpointRow/);
  assert.ok(source.indexOf("if (queuedEvents >= MAX_EVENTS_PER_RUN) break;", source.indexOf("Reaching the event cap")) < source.indexOf("checkpointRow = rows.findLast", source.indexOf("Reaching the event cap")));
  assert.match(source, /const lastRow = checkpointRow;/);
});
