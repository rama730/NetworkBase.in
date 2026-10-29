import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the workspace-setup exit dialog favors recovery and clearly isolates the destructive action", async () => {
  const [dialog, wizard] = await Promise.all([
    readFile("src/components/projects/create-wizard/LeaveProjectSetupDialog.tsx", "utf8"),
    readFile("src/components/projects/create-wizard/CreateProjectWizard.tsx", "utf8"),
  ]);

  assert.match(dialog, /Unsaved changes/);
  assert.match(dialog, /Leave workspace setup\?/);
  assert.match(dialog, /save a draft from the footer before you leave/i);
  assert.match(dialog, /Saved drafts can be resumed/);
  assert.match(dialog, /variant="outline"[\s\S]*Keep editing/);
  assert.match(dialog, /variant="destructive"[\s\S]*Leave setup/);
  assert.match(dialog, /autoFocus/);
  assert.match(dialog, /aria-describedby="leave-project-setup-description"/);
  // "Leave setup" discards on purpose, so it skips the save-on-leave draft before closing.
  assert.match(wizard, /const leaveSetup = \(\) => \{\s*markLeaving\(\);\s*onClose\(\);/);
  assert.match(wizard, /<LeaveProjectSetupDialog[\s\S]*onLeave=\{leaveSetup\}/);
  assert.doesNotMatch(wizard, /<ConfirmDialog/);
});
