import { test } from "node:test";
import assert from "node:assert/strict";
import { cliWorkspaceInput, createWorkspaceSchema } from "@/lib/validations/workspace";

test("nb workspace create sends what the app's create accepts (T16 live test: 'Other' without a type name failed)", async () => {
  const parsed = createWorkspaceSchema.safeParse(cliWorkspaceInput("T16 README check", "A workspace for T16 README check.", "private"));
  assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | "));
});
