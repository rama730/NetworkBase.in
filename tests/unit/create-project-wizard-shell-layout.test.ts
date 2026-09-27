import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("create-project shell keeps progress in a compact centered header and save feedback in the footer", async () => {
  const [header, footer, wizard] = await Promise.all([
    readFile("src/components/projects/create-wizard/WizardHeader.tsx", "utf8"),
    readFile("src/components/projects/create-wizard/WizardFooter.tsx", "utf8"),
    readFile("src/components/projects/create-wizard/CreateProjectWizard.tsx", "utf8"),
  ]);

  assert.match(header, /<h1[^>]*>Create project<\/h1>/);
  assert.match(header, /grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
  assert.match(header, /md:grid-cols-\[minmax\(9rem,1fr\)_auto_minmax\(9rem,1fr\)\]/);
  assert.match(header, /justify-self-center/);
  assert.doesNotMatch(header, /Draft not saved|Draft not saved yet|formatDistanceToNow/);

  assert.match(footer, /saveStatus: "idle" \| "saving" \| "saved" \| "error"/);
  assert.match(footer, /Saved \$\{formatDistanceToNow\(lastSaved\)\} ago/);
  assert.match(footer, /sm:grid-cols-\[minmax\(8rem,1fr\)_auto_minmax\(8rem,1fr\)\]/);
  assert.match(footer, /sm:col-start-2 sm:row-start-1 sm:justify-self-center/);

  assert.match(wizard, /<WizardHeader currentPhase=\{phase\} onClose=\{handleCloseAttempt\} \/>/);
  assert.match(wizard, /<WizardFooter[\s\S]*saveStatus=\{saveStatus\}[\s\S]*lastSaved=\{lastSaved\}/);
});
