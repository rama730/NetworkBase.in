import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("project contribution sequencing", () => {
  it("allocates event order on the dedicated counter row", () => {
    assert.match(read("drizzle/0006_workspaces_members.sql"), /CREATE TABLE public\.workspace_event_counters /);
    assert.match(read("drizzle/0009_files.sql"), /public\.workspace_event_counters\.next_sequence \+ 1/);
    const migration = read("drizzle/0013_contributions.sql");
    assert.match(migration, /VALUES \(project_uuid,NEW\.node_id,NEW\.uploaded_by,'file_content_contributed',0,/);

    const contributionFunction = migration.slice(
      migration.indexOf("CREATE FUNCTION public.record_file_content_contribution"),
    );
    assert.doesNotMatch(contributionFunction, /UPDATE public\.workspaces SET current_sequence_number/);
  });

  it("allocates one sequence range for a batch", () => {
    const helpers = read("src/lib/files/internal-helpers.ts");
    assert.match(helpers, /insert\(workspaceEventCounters\)/);
    assert.match(helpers, /nextSequence: sql`\$\{workspaceEventCounters\.nextSequence\} \+ \$\{count\}`/);
    assert.match(helpers, /startSeq \+ idx \+ 1/);
  });

  it("reads synchronization watermarks from the counter authority", () => {
    assert.match(read("src/lib/github/sync-service.ts"), /workspaceEventCounters/);
    assert.match(read("src/app/api/v1/workspaces/[id]/sync-diff/route.ts"), /workspaceEventCounters\.nextSequence/);
    assert.match(read("src/app/api/v1/extension/workspace/route.ts"), /workspaceEventCounters\.nextSequence/);
  });
});
