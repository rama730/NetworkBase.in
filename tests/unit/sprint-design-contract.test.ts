import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Sprints Tab Design Specification Conformance Contract (Sections 03, 04, 05, 10, 25)", async (t) => {
  const tabsDir = path.join(process.cwd(), "src/components/workspaces/tabs");
  const sprintDir = path.join(process.cwd(), "src/components/workspaces/tabs/sprint");
  const modalsDir = path.join(process.cwd(), "src/components/workspaces/v2/sprints");

  const sprintPlanning = fs.readFileSync(path.join(tabsDir, "SprintPlanning.tsx"), "utf-8");
  const sprintHeader = fs.readFileSync(path.join(sprintDir, "SprintHeader.tsx"), "utf-8");
  const sprintLeftRail = fs.readFileSync(path.join(sprintDir, "SprintLeftRail.tsx"), "utf-8");
  const sprintTimeline = fs.readFileSync(path.join(sprintDir, "SprintTimelineContent.tsx"), "utf-8");
  const sprintLifecycleModals = fs.readFileSync(path.join(sprintDir, "SprintLifecycleModals.tsx"), "utf-8");
  const createSprintModal = fs.readFileSync(path.join(modalsDir, "CreateSprintModal.tsx"), "utf-8");

  const allSprintComponents = [
    { name: "SprintPlanning", content: sprintPlanning },
    { name: "SprintHeader", content: sprintHeader },
    { name: "SprintLeftRail", content: sprintLeftRail },
    { name: "SprintTimelineContent", content: sprintTimeline },
    { name: "SprintLifecycleModals", content: sprintLifecycleModals },
    { name: "CreateSprintModal", content: createSprintModal },
  ];

  await t.test("Strict zero rounded-full controls or pills across all sprint components", () => {
    for (const comp of allSprintComponents) {
      assert.doesNotMatch(
        comp.content,
        /rounded-full/,
        `${comp.name} must not contain any rounded-full pill shapes or controls`,
      );
    }
  });

  await t.test("Strict zero zinc-* token leaks across all sprint components", () => {
    for (const comp of allSprintComponents) {
      assert.doesNotMatch(
        comp.content,
        /text-zinc-|bg-zinc-|border-zinc-|divide-zinc-/,
        `${comp.name} must not contain any raw zinc-* tokens`,
      );
    }
  });

  await t.test("Strict zero blue-* token leaks across all sprint components", () => {
    for (const comp of allSprintComponents) {
      assert.doesNotMatch(
        comp.content,
        /text-blue-|bg-blue-|border-blue-|hover:text-blue-|hover:bg-blue-/,
        `${comp.name} must not contain any raw blue-* tokens`,
      );
    }
  });

  await t.test("SprintPlanning empty state conforms to canonical .nb-empty-state specification", () => {
    assert.match(sprintPlanning, /nb-empty-state/, "Empty state must use .nb-empty-state class");
    assert.match(sprintPlanning, /nb-empty-state-icon/, "Empty state icon must use .nb-empty-state-icon class");
    assert.match(sprintPlanning, /nb-empty-state-title/, "Empty state title must use .nb-empty-state-title class");
    assert.match(sprintPlanning, /nb-empty-state-desc/, "Empty state description must use .nb-empty-state-desc class");
  });

  await t.test("SprintLeftRail conforms to square status indicators and desktop button standards", () => {
    assert.match(
      sprintLeftRail,
      /size-1\.5 shrink-0 rounded-sm/,
      "Status indicator must use Section 10 square geometry (rounded-sm)",
    );
    assert.match(
      sprintLeftRail,
      /h-\[34px\].*rounded-(?:\[5px\]|md)/,
      "New sprint button must adhere to Section 05 h-[34px] rounded-[5px] desktop height",
    );
    assert.match(
      sprintLeftRail,
      /font-mono text-\[11px\]/,
      "Sprint codes must use JetBrains Mono uppercase tracking",
    );
    assert.match(
      sprintLeftRail,
      /aria-expanded=\{!isCollapsed\}/,
      "Sprint group controls must expose their expanded state",
    );
    assert.match(
      sprintLeftRail,
      /aria-controls=\{groupContentId\}/,
      "Sprint group controls must reference their controlled content",
    );
    assert.match(
      sprintLeftRail,
      /aria-current=\{isSelected \? "page" : undefined\}/,
      "The selected sprint must be announced as the current page",
    );
  });

  await t.test("SprintHeader conforms to Section 05 button heights and Section 10 badges", () => {
    assert.match(
      sprintHeader,
      /h-\[34px\].*rounded-(?:\[5px\]|md)/,
      "Action buttons must adhere to Section 05 h-[34px] rounded-[5px] desktop height",
    );
    assert.match(
      sprintHeader,
      /rounded-(?:\[3px\]|sm) font-mono text-\[11px\] font-medium uppercase tracking-\[0\.09em\]/,
      "Status badge must adhere to Section 10 badge geometry",
    );
  });

  await t.test("SprintTimelineContent conforms to clean drafting telemetry, 5px avatars, and badges", () => {
    assert.match(
      sprintTimeline,
      /aria-label="Sprint summary"/,
      "Summary metrics must adhere to clean drafting telemetry",
    );
    assert.doesNotMatch(
      sprintTimeline,
      /rounded-\[6px\] border border-border bg-card p-3 shadow-none/,
      "Must not contain bulky box stat cards",
    );
    assert.match(
      sprintTimeline,
      /roundedClassName="rounded-\[5px\]"/,
      "User avatar must adhere to Section 04 5px corner radius",
    );
    assert.match(
      sprintTimeline,
      /rounded-\[3px\].*font-mono text-\[11px\].*uppercase tracking-\[0\.09em\]/,
      "Task badges must adhere to Section 10 badge geometry",
    );
    assert.match(
      sprintTimeline,
      /h-\[34px\].*rounded-(?:\[5px\]|md)/,
      "Load more button must adhere to Section 05 h-[34px] rounded-[5px] desktop height",
    );
    assert.match(
      fs.readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf-8"),
      /html\[data-reduce-motion="true"\] \*/,
      "Task expansion motion must respect the user motion preference",
    );
    assert.match(
      sprintTimeline,
      /nb-touch-target/,
      "Compact sprint controls must expose a touch-safe target",
    );
  });

  await t.test("Sprint presentation uses semantic status tokens rather than raw color utilities", () => {
    const sprintPresentation = fs.readFileSync(
      path.join(process.cwd(), "src/lib/workspaces/sprint-detail.ts"),
      "utf-8",
    );

    assert.match(sprintPresentation, /nb-sprint-tone-success/);
    assert.match(sprintPresentation, /nb-sprint-tone-info/);
    assert.doesNotMatch(sprintPresentation, /(?:bg|text|border)-(?:zinc|blue|emerald|rose|red|indigo)-/);
  });

  await t.test("SprintLifecycleModals and CreateSprintModal conform to desktop control standards", () => {
    assert.match(sprintLifecycleModals, /FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS \} from "@\/components\/workspaces\/v2\/tasks\/form-parts"/, "Close and Cancel use the form buttons");
    assert.match(sprintLifecycleModals, /className="nb-select nb-touch-target w-full"/, "The sprint picker is the shared select");
    // Sprint redesign (2026-11-09): the form is New task's — its fields, footer and dialog come from form-parts.
    assert.match(createSprintModal, /from "\.\.\/tasks\/form-parts"/, "New sprint uses the Task form's parts");
    assert.match(createSprintModal, /className=\{FORM_DIALOG_CLASS\}/, "Same dialog as New task");
    assert.match(createSprintModal, /<div className=\{FORM_FOOTER_CLASS\}>/, "Same fixed footer as New task");
  });
});
