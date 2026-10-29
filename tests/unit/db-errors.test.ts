import assert from "node:assert/strict";
import test from "node:test";

import { isMissingRelationError } from "../../src/lib/db/errors";

test("recognizes a missing relation wrapped by Drizzle", () => {
    const error = Object.assign(new Error("Failed query: select * from workspace_sprint_events"), {
        cause: Object.assign(new Error('relation "workspace_sprint_events" does not exist'), { code: "42P01" }),
    });

    assert.equal(isMissingRelationError(error, "workspace_sprint_events"), true);
});
