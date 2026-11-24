import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("create-project shell keeps progress in a compact centered header and save feedback in the footer", async () => {
  const [header, footer, wizard] = await Promise.all([
    readFile("src/components/workspaces/create-wizard/WizardHeader.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/WizardFooter.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/CreateWorkspaceWizard.tsx", "utf8"),
  ]);

  // v6 step strip: the page title stays for screen readers; one cell per step and one sliding marker.
  assert.match(header, /<h1[^>]*className="sr-only">\{isOrganization \? "Create organization" : "Create workspace"\}<\/h1>/);
  assert.match(header, /className="nb-step-cells"/);
  assert.match(header, /data-step-marker/);
  assert.doesNotMatch(header, /Draft not saved|Draft not saved yet|formatDistanceToNow/);

  assert.match(footer, /saveStatus: "idle" \| "saving" \| "saved" \| "error"/);
  assert.match(footer, / · \{formatDistanceToNow\(lastSaved\)\} ago/);
  assert.match(footer, /sm:grid-cols-\[minmax\(8rem,1fr\)_auto_minmax\(8rem,1fr\)\]/);
  assert.match(footer, /sm:order-2 sm:justify-self-center/);

  assert.match(wizard, /<WizardStepStrip[\s\S]*?currentPhase=\{phase\}\s+onClose=\{handleCloseAttempt\}[\s\S]*?headingRef=\{headingRef\}\s*(?:isOrganization=\{isOrganization\}\s*)?\/>/);
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
  // v6 layout rule: every step starts at the same left edge (24px gutter); Info/Team 940px, Review 1220px, Start/Settings full width.
  assert.match(footer, /export const WIZARD_COLUMN = "w-full max-w-\[940px\]"/);
  // Settings (step 4) brings its own docked list and document padding (v6.3); every other step shares the 24px gutter.
  assert.match(wizard, /max-w-none' : phase === 5 \? 'max-w-\[1220px\]' : 'max-w-\[940px\]'\} \$\{phase === 4 \? '' : 'px-4 pb-12 pt-6 md:px-6 md:pt-7'\}/);
  // Sidebar and top bar stay, exactly like every other page.
  assert.doesNotMatch(layout, /if \(focus\)/);
  assert.match(layout, /<AppSidebar \/>[\s\S]*<TopNav \/>[\s\S]*\{children\}/);
  assert.match(loading, /<CreateWorkspaceShellSkeleton \/>/);
  assert.match(chat, /NO_WINDOW_PREFIXES = \["\/messages", "\/workspaces\/new", "\/my-profile\/edit"\]/);
  // Browser Back keeps work: unsaved changes are saved as a draft on unmount unless the user chose to leave.
  assert.match(hook, /if \(hasUnsavedRef\.current && !skipDraftOnUnmountRef\.current\) void saveDraftRef\.current\(true\)/);
  assert.match(hook, /if \(createdProjectId && onSuccess\) onSuccess\(createdProjectId, createdOrganization\);\s*else onClose\(\);/);
});

test("create-project page refinements: Esc asks like Cancel, clickable finished steps, current-page button, quiet saving, draft choice first, one mobile header row", async () => {
  const [wizard, header, footer, topNav, mobileMenu] = await Promise.all([
    readFile("src/components/workspaces/create-wizard/CreateWorkspaceWizard.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/WizardHeader.tsx", "utf8"),
    readFile("src/components/workspaces/create-wizard/WizardFooter.tsx", "utf8"),
    readFile("src/components/layout/header/TopNav.tsx", "utf8"),
    readFile("src/components/layout/header/MobileMenu.tsx", "utf8"),
  ]);

  // 1. A page, not a dialog: Cancel is explicit; Esc on the page asks the same (v6), never from inside a field, menu or dialog.
  assert.match(wizard, /event\.key !== 'Escape'/);
  assert.match(wizard, /closest\('input, textarea, select, \[contenteditable="true"\], \[role="dialog"\]/);
  assert.match(header, /"Cancel workspace setup"/);
  assert.match(header, /<X aria-hidden="true" \/><span>Cancel<\/span>/);

  // 2. Finished steps jump back; later steps stay locked.
  assert.match(header, /left && onStepSelect \? \(/);
  assert.match(header, /onClick=\{\(\) => onStepSelect\(step\.id\)\}/);
  assert.match(wizard, /onStepSelect=\{goToPhase\}/);

  // 3. New workspace reads as the current page on /workspaces/new.
  assert.match(topNav, /aria-current=\{isCreateProjectRoute \? 'page' : undefined\}/);
  assert.match(mobileMenu, /aria-current=\{pathname === "\/workspaces\/new" \? "page" : undefined\}/);

  // 4. Autosave is primary (v6): no Save draft or Save now button; the status line says it saves, then when it did.
  assert.doesNotMatch(footer, /Save draft<\/span>|<Save |Save now/);
  assert.match(footer, /as you go/);
  assert.match(footer, /on this device<\/span> · \{formatDistanceToNow\(lastSaved\)\} ago/);

  // 5. The saved-draft choice sits above the form, not above the footer.
  assert.ok(wizard.indexOf("Continue your saved draft?") < wizard.indexOf("ref={scrollBodyRef}"));
  assert.match(wizard, /flex-shrink-0 border-b border-border bg-secondary\/45/);

  // 6. Phones (v6): one 56px row — "Info · 2 of 5" and five squares — not a second progress row.
  assert.doesNotMatch(header, /MobileProgressBar/);
  assert.match(header, /\{currentLabel\} · \{currentPhase\} of \{WIZARD_PHASES\.length\}/);
  assert.match(header, /nb-step-squares/);
});

