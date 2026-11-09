import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file: string) => fs.readFileSync(file, "utf8");

// Unified back R6: while an upload runs, the arrow, browser back, swipe and sidebar links ask first.
test("one shared leave guard; profile edit and uploads both use it", () => {
  const guard = read("src/hooks/useLeaveGuard.ts");
  assert.match(guard, /export function useLeaveGuard\(dirty: boolean, saving = false\)/);
  assert.match(guard, /APP_BEFORE_NAVIGATE_EVENT/);
  assert.match(guard, /'popstate'/);
  assert.equal(fs.existsSync("src/components/profile/edit/useProfileEditNavigationGuard.ts"), false);
  assert.match(read("src/components/profile/edit/EditProfileEditor.tsx"), /useLeaveGuard\(hasChanges, saveState === "saving"\)/);

  const transfers = read("src/components/workspaces/v2/files-tab/FileTransfers.tsx");
  assert.match(transfers, /useLeaveGuard\(active > 0\)/);
  assert.match(transfers, /title="An upload is still running\. Leave anyway\?"/);
});

test("the back arrow asks leave guards first", () => {
  assert.match(read("src/hooks/useBack.ts"), /confirmAppNavigation\(/);
});
