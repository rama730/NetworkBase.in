import assert from "node:assert/strict";
import test from "node:test";
import { execSync } from "node:child_process";

// Small things in the mix style (docs/superpowers/plans/2026-11-23-small-things-build.md): each sweep leaves a rule here
// so the old pattern can't come back.
const filesWith = (pattern: string) => execSync(`grep -rlE ${JSON.stringify(pattern)} src --include='*.tsx' --include='*.ts' || true`, { encoding: "utf8" }).split("\n").filter(Boolean).sort();

test("W1: loading placeholders use the shared skeleton; pulse is only for live status dots", () => {
  assert.deepEqual(filesWith("animate-pulse"), [
    "src/components/trust/InboxList.tsx",
    "src/components/workspaces/v2/preview/drivers/MediaViewerDriver.tsx",
    "src/components/workspaces/v2/tasks/TaskDetailTabs/DetailsTab.tsx",
  ]);
});

test("W4: no spinners — waiting is the pixel beat, and a busy button uses `pending`", () => {
  assert.deepEqual(filesWith("Loader2|LoaderCircle|animate-spin"), []);
});

test("W7: status words use a real ellipsis (Saving…, not Saving...)", () => {
  assert.deepEqual(filesWith("\"[A-Z][a-z]+ing\\.\\.\\.|[A-Z][a-z]+ing\\.\\.\\.[\"'<]|placeholder=\"[^\"]*\\.\\.\\.\""), []);
});

test("W7: a visible wait shows the pixel beat with its words, never bare Loading text", () => {
  // Bare: `>Loading…<`, or a "Loading…" string swapped in as the whole label. Screen-reader text, skeleton labels and
  // other sessions' files in progress are left out.
  const bare = execSync(`grep -rnE ">\\s*Loading[^<{]*…|[?:] *[\\"']Loading[^\\"']*…[\\"']" src --include='*.tsx' || true`, { encoding: "utf8" })
    .split("\n").filter(Boolean)
    .filter((line) => !/sr-only|aria-label|label=|PixelBeat[^>]*\/>\s*Loading|ThreadPane\.tsx|MessageRow\.tsx|YourSettingsSection\.tsx/.test(line));
  assert.deepEqual(bare, []);
});

test("F5: no confetti — a joined moment is the pixel burst, and the dependency is gone", () => {
  assert.deepEqual(filesWith("canvas-confetti"), []);
  assert.doesNotMatch(execSync("cat package.json", { encoding: "utf8" }), /canvas-confetti/);
});

test("C4: one switch — hand-made role=switch controls are gone except the profile's open-to tag", () => {
  assert.deepEqual(filesWith('role="switch"'), ["src/components/profile/v2/ProfileBand.tsx"]);
});

test("C11: a destructive menu item uses the menu's destructive variant, not its own red", () => {
  const own = execSync(`grep -rnE "<DropdownMenuItem[^>]*className=[^>]*text-(destructive|red-)" src --include='*.tsx' || true`, { encoding: "utf8" }).split("\n").filter(Boolean).filter((l) => !l.includes('variant="destructive"'));
  assert.deepEqual(own, []);
});
