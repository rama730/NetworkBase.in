import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("create-project shell keeps progress in a compact centered header and save feedback in the footer", async () => {
  const [header, footer, wizard] = await Promise.all([
    readFile("src/components/workspaces/create-wizard/WizardHeader.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/WizardFooter.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/CreateWorkspaceWizard.tsx", "utf8"),
  ]);

  assert.match(header, /<h1[^>]*>\{isOrganization \? "Create organization" : "Create workspace"\}<\/h1>/);
  assert.match(header, /grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
  assert.match(header, /md:grid-cols-\[minmax\(9rem,1fr\)_auto_minmax\(9rem,1fr\)\]/);
  assert.match(header, /justify-self-center/);
  assert.doesNotMatch(header, /Draft not saved|Draft not saved yet|formatDistanceToNow/);

  assert.match(footer, /saveStatus: "idle" \| "saving" \| "saved" \| "error"/);
  assert.match(footer, /Saved \$\{formatDistanceToNow\(lastSaved\)\} ago/);
  assert.match(footer, /sm:grid-cols-\[minmax\(8rem,1fr\)_auto_minmax\(8rem,1fr\)\]/);
  assert.match(footer, /sm:col-start-2 sm:row-start-1 sm:justify-self-center/);

  assert.match(wizard, /<WizardHeader\s+currentPhase=\{phase\}\s+onClose=\{handleCloseAttempt\}[\s\S]*?headingRef=\{headingRef\}\s*(?:isOrganization=\{isOrganization\}\s*)?\/>/);
  assert.match(wizard, /<WizardFooter[\s\S]*saveStatus=\{saveStatus\}[\s\S]*lastSaved=\{lastSaved\}/);
});

test("create-workspace is a normal page inside the app shell: no modal, one 1000px column", async () => {
  const [wizard, footer, layout, loading, hook, chat] = await Promise.all([
    readFile("src/components/workspaces/create-wizard/CreateWorkspaceWizard.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/WizardFooter.tsx", "utf8"),
    readFile("src/components/layout/MainLayout.tsx", "utf8"),
    readFile("src/app/(site)/(main)/workspaces/new/loading.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/useCreateWorkspaceWizard.ts", "utf8"),
    readFile("src/components/messages/chat-window-store.ts", "utf8"),
  ]);

  assert.doesNotMatch(wizard, /@\/components\/ui\/dialog|presentation/);
  assert.match(wizard, /relative flex h-full min-h-0 w-full flex-col/);
  assert.match(footer, /export const WIZARD_COLUMN = "mx-auto w-full max-w-\[1000px\]"/);
  assert.match(wizard, /\$\{WIZARD_COLUMN\} px-4 pb-6 pt-5 md:px-6 md:py-8/);
  // Sidebar and top bar stay, exactly like every other page.
  assert.doesNotMatch(layout, /if \(focus\)/);
  assert.match(layout, /<AppSidebar \/>[\s\S]*<TopNav \/>[\s\S]*\{children\}/);
  assert.match(loading, /<CreateProjectShellSkeleton \/>/);
  assert.match(chat, /NO_WINDOW_PREFIXES = \["\/messages", "\/workspaces\/new", "\/my-profile\/edit"\]/);
  // Browser Back keeps work: unsaved changes are saved as a draft on unmount unless the user chose to leave.
  assert.match(hook, /if \(hasUnsavedRef\.current && !skipDraftOnUnmountRef\.current\) void saveDraftRef\.current\(true\)/);
  assert.match(hook, /if \(createdProjectId && onSuccess\) onSuccess\(createdProjectId, createdOrganization\);\s*else onClose\(\);/);
});

test("create-project page refinements: no Esc close, clickable finished steps, current-page button, quiet saving, draft choice first, one mobile header row", async () => {
  const [wizard, header, footer, topNav, mobileMenu] = await Promise.all([
    readFile("src/components/workspaces/create-wizard/CreateWorkspaceWizard.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/WizardHeader.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/WizardFooter.tsx", "utf8"),
    readFile("src/components/layout/header/TopNav.tsx", "utf8"),
    readFile("src/components/layout/header/MobileMenu.tsx", "utf8"),
  ]);

  // 1. A page, not a dialog: no Esc-to-close; an explicit Cancel.
  assert.doesNotMatch(wizard, /'Escape'/);
  assert.match(header, /aria-label="Cancel workspace setup"/);
  assert.match(header, /<span className="max-md:hidden">Cancel<\/span>/);

  // 2. Finished steps jump back; later steps stay locked.
  assert.match(header, /completed && onStepSelect \? \(/);
  assert.match(header, /onClick=\{\(\) => onStepSelect\(wizardPhase\.id\)\}/);
  assert.match(wizard, /onStepSelect=\{goToPhase\}/);

  // 3. New workspace reads as the current page on /workspaces/new.
  assert.match(topNav, /aria-current=\{isCreateProjectRoute \? 'page' : undefined\}/);
  assert.match(mobileMenu, /aria-current=\{pathname === "\/workspaces\/new" \? "page" : undefined\}/);

  // 4. Autosave is primary: no Save draft button, a quiet "Save now" in the status line.
  assert.doesNotMatch(footer, /Save draft<\/span>|<Save /);
  assert.match(footer, /Save now/);

  // 5. The saved-draft choice sits above the form, not above the footer.
  assert.ok(wizard.indexOf("Continue your saved draft?") < wizard.indexOf("ref={scrollBodyRef}"));
  assert.match(wizard, /flex-shrink-0 border-b border-border bg-secondary\/45/);

  // 6. Phones: one 56px header row (title + step) and a thin progress line, not a second progress row.
  assert.doesNotMatch(header, /MobileProgressBar/);
  assert.match(header, /Step \{currentPhase\} of \{WIZARD_PHASES\.length\}/);
  assert.match(header, /role="progressbar"[\s\S]*className="h-0\.5 bg-muted md:hidden"/);
});

