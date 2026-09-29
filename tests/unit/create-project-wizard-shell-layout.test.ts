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

  assert.match(wizard, /<WizardHeader currentPhase=\{phase\} onClose=\{handleCloseAttempt\} headingRef=\{headingRef\} \/>/);
  assert.match(wizard, /<WizardFooter[\s\S]*saveStatus=\{saveStatus\}[\s\S]*lastSaved=\{lastSaved\}/);
});

test("create-project is a full-page focus route: no modal, no app shell, one 1000px column", async () => {
  const [wizard, footer, layout, loading, hook, chat] = await Promise.all([
    readFile("src/components/projects/create-wizard/CreateProjectWizard.tsx", "utf8"),
    readFile("src/components/projects/create-wizard/WizardFooter.tsx", "utf8"),
    readFile("src/components/layout/MainLayout.tsx", "utf8"),
    readFile("src/app/(site)/(main)/projects/new/loading.tsx", "utf8"),
    readFile("src/components/projects/create-wizard/useCreateProjectWizard.ts", "utf8"),
    readFile("src/components/chat/v2/ChatPopupV2.tsx", "utf8"),
  ]);

  assert.doesNotMatch(wizard, /@\/components\/ui\/dialog|presentation/);
  assert.match(wizard, /flex h-dvh min-h-0 w-full flex-col/);
  assert.match(footer, /export const WIZARD_COLUMN = "mx-auto w-full max-w-\[1000px\]"/);
  assert.match(wizard, /\$\{WIZARD_COLUMN\} px-4 pb-6 pt-5 md:px-6 md:py-8/);
  assert.match(layout, /const focus = pathname === CREATE_PROJECT_PATH/);
  assert.match(layout, /if \(focus\) \{[\s\S]*<main id="main-content"/);
  assert.match(loading, /<CreateProjectShellSkeleton \/>/);
  assert.match(chat, /pathname === '\/projects\/new'/);
  // Browser Back keeps work: unsaved changes are saved as a draft on unmount unless the user chose to leave.
  assert.match(hook, /if \(hasUnsavedRef\.current && !skipDraftOnUnmountRef\.current\) void saveDraftRef\.current\(true\)/);
  assert.match(hook, /if \(createdProjectId && onSuccess\) onSuccess\(createdProjectId\);\s*else onClose\(\);/);
});
