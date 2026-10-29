import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("project contribution sequencing", () => {
  it("allocates event order on the dedicated counter row", () => {
    const migration = read("drizzle/0178_storage_asset_lifecycle.sql");
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.project_event_counters/);
    assert.match(migration, /public\.project_event_counters\.next_sequence \+ 1/);
    assert.match(migration, /VALUES \(project_uuid,NEW\.node_id,NEW\.uploaded_by,'file_content_contributed',0,/);

    const contributionFunction = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.record_file_content_contribution"),
    );
    assert.doesNotMatch(contributionFunction, /UPDATE public\.projects SET current_sequence_number/);
  });

  it("allocates one sequence range for a batch", () => {
    const helpers = read("src/lib/files/internal-helpers.ts");
    assert.match(helpers, /insert\(projectEventCounters\)/);
    assert.match(helpers, /nextSequence: sql`\$\{projectEventCounters\.nextSequence\} \+ \$\{count\}`/);
    assert.match(helpers, /startSeq \+ idx \+ 1/);
  });

  it("reads synchronization watermarks from the counter authority", () => {
    assert.match(read("src/lib/github/sync-service.ts"), /projectEventCounters/);
    assert.match(read("src/app/api/v1/workspaces/[id]/sync-diff/route.ts"), /projectEventCounters\.nextSequence/);
    assert.match(read("src/app/api/v1/extension/workspace/route.ts"), /projectEventCounters\.nextSequence/);
  });
});
