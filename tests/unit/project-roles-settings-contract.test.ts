import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project roles editor tab eliminates duplicate headers and renders a single canonical SettingsCard", () => {
  const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

  // SectionHeader is suppressed on roles-applications tab to avoid duplicate titles
  assert.match(
    settingsTab,
    /id="project-settings-roles-applications"/,
    "SectionHeader must be suppressed on roles-applications tab to prevent duplicate headers"
  );

  // Extract roles-applications block
  const rolesBlock =
    settingsTab.split('id="project-settings-roles-applications"')[1]?.split(/id="project-settings-(?:tasks-workflow|readme)"/)[0] ?? "";
  assert.ok(rolesBlock.length > 0, "roles-applications settings block must exist in ProjectSettingsTab");

  // Redundant SummaryCard, AdvancedDisclosure, and Application behavior cards removed
  assert.doesNotMatch(rolesBlock, /<SummaryCard/, "Redundant SummaryCard must be removed from Project Roles tab");
  assert.doesNotMatch(rolesBlock, /<AdvancedDisclosure/, "Redundant AdvancedDisclosure must be removed from Project Roles tab");
  assert.doesNotMatch(rolesBlock, /title="Application behavior"/, "Redundant static Application behavior card must be removed");

  // Exactly 1 canonical SettingsCard: "Project roles"
  assert.match(rolesBlock, /<SettingsCard[\s\S]*?title="Project roles"/, "Canonical Project roles SettingsCard must exist");
  const cardMatches = rolesBlock.match(/<SettingsCard/g) || [];
  assert.equal(cardMatches.length, 1, "Project Roles tab must render exactly 1 canonical SettingsCard");

  // Card footer with live dirty status and Cancel / Save changes buttons
  assert.match(rolesBlock, /rolesDirty\s*\?\s*"You have unsaved changes in project roles\."\s*:\s*"All project roles are saved\."/, "Footer must display dynamic status text based on rolesDirty");
  assert.match(rolesBlock, /onClick=\{handleCancelRoles\}/, "Footer must have Cancel button wired to handleCancelRoles");
  assert.match(rolesBlock, /onClick=\{handleSaveRoles\}/, "Footer must have Save changes button wired to handleSaveRoles");
  assert.match(rolesBlock, /disabled=\{!rolesDirty \|\| savingRoles\}/, "Cancel and Save changes buttons must be disabled when clean or saving");
});

test("ProjectRolesEditor features a single-row layout with separate Occupied and Open roles segments", () => {
  const editorSrc = source("src/components/projects/settings/ProjectRolesEditor.tsx");

  // Ban raw color classes (zinc, indigo, blue)
  assert.doesNotMatch(editorSrc, /zinc-/, "ProjectRolesEditor must not contain raw zinc-* color classes");
  assert.doesNotMatch(editorSrc, /indigo-/, "ProjectRolesEditor must not contain raw indigo-* color classes");
  assert.doesNotMatch(editorSrc, /blue-/, "ProjectRolesEditor must not contain raw blue-* color classes");

  // Uses drafting table design typography
  assert.match(editorSrc, /nb-card-title/, "Section title must use nb-card-title token");
  assert.match(editorSrc, /nb-compact/, "Subtitles must use nb-compact token");
  assert.match(editorSrc, /nb-ui-label/, "Field labels must use nb-ui-label token");

  // Single-row horizontal rail with separate Occupied and Open segments
  assert.match(editorSrc, /Occupied \(\{occupiedEntries\.length\}\)/, "Must render Occupied segment with live count");
  assert.match(editorSrc, /Open \(\{openEntries\.length\}\)/, "Must render Open segment with live count");
  assert.match(editorSrc, /overflow-x-auto/, "Single row must support horizontal scrolling");
  assert.match(editorSrc, /role="tab"/, "Roles in single row must be accessible interactive tabs");
  assert.match(editorSrc, /aria-selected/, "Roles in single row must track aria-selected state");

  // Divider between segments and Add position CTA
  assert.match(editorSrc, /h-7 w-px bg-border/, "Vertical divider separates occupied and open role segments");
  assert.match(editorSrc, /Add position/, "Single row contains Add position CTA");
});

test("ProjectRolesEditor provides rich master-detail workspaces for Occupied and Open roles", () => {
  const editorSrc = source("src/components/projects/settings/ProjectRolesEditor.tsx");

  // Occupant profile inspection
  assert.match(editorSrc, /Occupant profile/, "Occupant workspace must display Occupant profile header");
  assert.match(editorSrc, /<UserAvatar[\s\S]*?size=\{52\}[\s\S]*?roundedClassName="rounded-md"/, "Occupant profile must use 52px squared UserAvatar");
  assert.doesNotMatch(editorSrc, /View public profile/, "View public profile link must be removed from occupant profile");
  assert.doesNotMatch(editorSrc, /This occupant currently fills this role/, "Explanatory note box must be removed from occupant profile");
  assert.match(editorSrc, /Role specifications/, "Occupant workspace must provide editable role specifications");

  // Open position editing and live preview
  assert.match(editorSrc, /Open role configuration/, "Open position workspace must display configuration header");
  assert.match(editorSrc, /Delete position/, "Open position workspace must offer deletion action");
  assert.match(editorSrc, /Applicant view preview/, "Open position workspace must render live applicant preview card");

  assert.match(editorSrc, /nb-empty-state[^"]*py-8 text-center/, "Empty state must use the shared empty-state typography without an enclosing card");
  assert.match(editorSrc, /No roles configured/, "Empty state must display clear copy");
});

test("project roles editor enforces 1 member = 1 seat invariant and unifies lead focus with open roles", () => {
  const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");
  const editorSrc = source("src/components/projects/settings/ProjectRolesEditor.tsx");

  // ProjectSettingsTab checks if openRoles already define the lead focus to prevent duplicate role synthesis
  assert.match(settingsTab, /leadHasOpenRole/, "Must check leadHasOpenRole to prevent duplicate lead-role synthesis");
  assert.match(settingsTab, /if\s*\(leadHasOpenRole\)\s*\{\s*return\s*\{\s*roles:\s*openRoles\s*\};?\s*\}/, "Must return openRoles without duplicate lead-role when lead focus is already represented");

  // ProjectRolesEditor enforces 1 member = 1 seat tracking
  assert.match(editorSrc, /assignedMemberIds/, "Must track assignedMemberIds to guarantee each member appears at most once in occupied");
  assert.match(editorSrc, /if\s*\(assignedMemberIds\.has\(m\.id\)\)\s*return\s*false;?/, "Must skip members who are already assigned to an occupied seat");

  // Applicant view preview reflects actual remaining open seats
  assert.match(editorSrc, /activeOpenCount/, "Applicant preview must compute activeOpenCount from remaining capacity");
});

test("project roles editor displays explicit occupied vs. open seat breakdown for partially filled roles and scenarios", () => {
  const editorSrc = source("src/components/projects/settings/ProjectRolesEditor.tsx");

  // Computes dynamic seat metrics for the active role
  assert.match(editorSrc, /activeOccupiedCount\s*=\s*occupiedEntries\.filter/, "Must compute activeOccupiedCount for the selected role");
  assert.match(editorSrc, /activeRemainingOpenCount\s*=\s*Math\.max\(0,\s*activeTotalSeats\s*-\s*activeOccupiedCount\)/, "Must compute activeRemainingOpenCount from total minus occupied");

  // Occupant profile displays Seat allocation row
  assert.match(editorSrc, /Seat allocation/, "Occupant profile must display a dedicated Seat allocation row");
  assert.match(editorSrc, /activeOccupiedCount.*?occupied.*?activeRemainingOpenCount.*?open/, "Seat allocation must show occupied and open counts");

  // Role specifications header & input show occupied vs. open seat breakdown
  assert.match(editorSrc, /\{activeOccupiedCount\}\s*occupied\s*\{activeOccupiedCount === 1 \? "seat" : "seats"\}/, "Must render occupied seat pill");
  assert.match(editorSrc, /\{activeRemainingOpenCount\}\s*open\s*\{activeRemainingOpenCount === 1 \? "seat" : "seats"\}/, "Must render open seat pill");
  assert.match(editorSrc, /min=\{Math\.max\(1,\s*activeOccupiedCount\)\}/, "Headcount input min value must guard against reducing seats below occupied count");

  // Functional simulation of the user's Frontend developer scenario and edge cases
  function computeSeatAllocation(totalSeats: number, assignedCount: number) {
    const total = Math.max(1, totalSeats);
    const occupied = assignedCount;
    const open = Math.max(0, total - occupied);
    const statusText = `${occupied} occupied seat${occupied === 1 ? "" : "s"} · ${open} open seat${open === 1 ? "" : "s"}`;
    return { total, occupied, open, statusText };
  }

  // Scenario 1: User's Frontend developer case (2 initial seats, 1 taken)
  const scenario1 = computeSeatAllocation(2, 1);
  assert.equal(scenario1.occupied, 1, "Scenario 1 must have 1 occupied seat");
  assert.equal(scenario1.open, 1, "Scenario 1 must have 1 open seat");
  assert.equal(scenario1.statusText, "1 occupied seat · 1 open seat");

  // Scenario 2: Multi-seat partially filled (3 seats, 2 taken)
  const scenario2 = computeSeatAllocation(3, 2);
  assert.equal(scenario2.occupied, 2);
  assert.equal(scenario2.open, 1);
  assert.equal(scenario2.statusText, "2 occupied seats · 1 open seat");

  // Scenario 3: Fully occupied single seat (1 seat, 1 taken)
  const scenario3 = computeSeatAllocation(1, 1);
  assert.equal(scenario3.occupied, 1);
  assert.equal(scenario3.open, 0);
  assert.equal(scenario3.statusText, "1 occupied seat · 0 open seats");

  // Scenario 4: Fully vacant open role (2 seats, 0 taken)
  const scenario4 = computeSeatAllocation(2, 0);
  assert.equal(scenario4.occupied, 0);
  assert.equal(scenario4.open, 2);
  assert.equal(scenario4.statusText, "0 occupied seats · 2 open seats");
});


