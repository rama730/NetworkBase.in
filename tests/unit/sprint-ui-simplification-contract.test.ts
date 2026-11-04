import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { projectActionsSource } from "./_workspace-actions-source";

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const sprintPlanningSource = readSource(
  "src/components/workspaces/tabs/SprintPlanning.tsx",
);
const sprintHeaderSource = readSource(
  "src/components/workspaces/tabs/sprint/SprintHeader.tsx",
);
const sprintLeftRailSource = readSource(
  "src/components/workspaces/tabs/sprint/SprintLeftRail.tsx",
);
const sprintTimelineSource = readSource(
  "src/components/workspaces/tabs/sprint/SprintTimelineContent.tsx",
);
const sprintLifecycleModalsSource = readSource(
  "src/components/workspaces/tabs/sprint/SprintLifecycleModals.tsx",
);
const sprintEditorSource = readSource(
  "src/components/workspaces/v2/sprints/CreateSprintModal.tsx",
);
const sprintActionsSource = projectActionsSource();

describe("sprint tab target architecture contract", () => {
  it("keeps canonical Sprint and task references in URLs", () => {
    assert.match(sprintPlanningSource, /selectedSprint\.code/);
    assert.match(sprintPlanningSource, /params\.delete\("sprintId"\)/);
    assert.match(
      sprintPlanningSource,
      /params\.set\("sprint", selectedSprint\.code\)/,
    );
    assert.match(sprintTimelineSource, /projectKey\?\.trim\(\) \|\| "Task"/);
    assert.match(sprintTimelineSource, /drawerId: taskReference \?\? task\.id/);
    assert.doesNotMatch(sprintTimelineSource, /`NB-\$\{task\.taskNumber\}`/);
  });

  it("shows the compact authoritative Sprint header", () => {
    assert.match(sprintHeaderSource, /\{sprint\.code\}/, "the code lives in the ⋯ menu");
    assert.match(sprintHeaderSource, /PHASE_WORDS\[phase\]/, "sprint redesign §4: one phase word");
    assert.match(sprintHeaderSource, /formatSprintDateRange/);
    assert.match(sprintHeaderSource, /\{sprint\.name\}/);
    assert.doesNotMatch(sprintHeaderSource, /Progress|Activity|Baseline/);
  });

  it("implements the schedule-owned lifecycle instead of a manual status toggle", () => {
    // Sprint redesign §4: Close sprint once it has ended, Complete early while it runs, Cancel and Archive in ⋯.
    for (const control of ["Close sprint", "Complete early", "Cancel sprint", "Archive sprint", "Add work"]) {
      assert.match(sprintHeaderSource, new RegExp(control));
    }
    assert.match(sprintHeaderSource, /Starts by itself/);
    assert.doesNotMatch(sprintHeaderSource, /Start sprint|Reopen sprint/);
    assert.match(sprintLifecycleModalsSource, /unfinishedChoice/);
    // Sprint redesign §8.7: open work goes to the next sprint (named), the backlog, or stays here, for the record.
    assert.match(sprintLifecycleModalsSource, /title: "The backlog"/);
    assert.match(sprintLifecycleModalsSource, /title: "Stay here, for the record"/);
    assert.match(sprintLifecycleModalsSource, /setUnfinishedChoice\(next \? "next_sprint" : "backlog"\)/);
    assert.match(sprintLifecycleModalsSource, /DialogContent/);
    assert.match(sprintLifecycleModalsSource, /DialogTitle/);
    assert.doesNotMatch(sprintLifecycleModalsSource, /role="alertdialog"/);
  });

  it("uses compact lifecycle and health summaries with explicit pagination", () => {
    assert.match(sprintTimelineSource, /aria-label="Sprint summary"/);
    assert.match(sprintTimelineSource, /aria-label="Sprint history"/);
    assert.match(sprintTimelineSource, /Use Add work to bring tasks from the backlog\./);
    assert.match(sprintTimelineSource, /workGroups\(tasks, by, mine \? user\?\.id : null\)/);
    assert.match(sprintTimelineSource, /Taken out of this sprint · \{view\.removed\.length\}/);
    assert.match(sprintTimelineSource, /hasMore && onLoadMore/);
    assert.match(sprintTimelineSource, /Load more tasks/);
    assert.doesNotMatch(sprintTimelineSource, /IntersectionObserver/);
  });

  it("categorizes linked files and keeps discussion owned by the Task panel", () => {
    assert.match(sprintTimelineSource, /role === "deliverable"/);
    assert.match(sprintTimelineSource, /role === "working"/);
    assert.match(sprintTimelineSource, /role === "reference"/);
    assert.match(sprintTimelineSource, /Final files/);
    assert.match(sprintTimelineSource, /Task references/);
    assert.match(sprintTimelineSource, /TASK_WORKING_FILES_TITLE/);
    assert.doesNotMatch(
      sprintTimelineSource,
      /getProjectTaskActivityAction|includeComments|animate-pulse/,
    );
  });

  it("uses accessible disclosure and motion behavior without the blue task outline", () => {
    assert.match(sprintTimelineSource, /aria-expanded=\{isExpanded\}/);
    assert.match(sprintTimelineSource, /aria-controls=/);
    assert.match(
      sprintTimelineSource,
      /aria-label=\{`\$\{isExpanded \? "Collapse" : "Expand"\}/,
    );
    assert.match(sprintTimelineSource, /focus-visible:outline/);
    assert.doesNotMatch(sprintTimelineSource, /ring-blue|outline-blue/);
  });

  it("groups current and historical Sprints and removes the obsolete drawer", () => {
    // Sprint redesign §5.1: the term — Now, Next, Later, Past — with gaps.
    // Board/review report §6: the term is the top-level sprints; the sprints inside a CO sit under it.
    assert.match(sprintLeftRailSource, /termRail\(nested\.top\)/);
    assert.match(sprintLeftRailSource, /aria-label=\{`Sprints in \$\{/);
    assert.match(sprintLeftRailSource, /No sprint planned/);
    assert.match(sprintLeftRailSource, /Past · \{group\.items\.length\}/);
    assert.equal(
      fs.existsSync(
        path.join(
          process.cwd(),
          "src/components/workspaces/tabs/sprint/SprintDetailDrawer.tsx",
        ),
      ),
      false,
    );
  });

  it("keeps date handling, editor state, and time-based lifecycle ownership deterministic", () => {
    assert.match(sprintTimelineSource, /completedAt/);
    assert.match(sprintEditorSource, /initializedDraftKeyRef/);
    assert.match(
      sprintActionsSource,
      /a read must not mutate Sprint lifecycle state/i,
    );
    assert.doesNotMatch(sprintActionsSource, /await startDueSprints\(/);
  });

  it("uses the persisted task completion timestamp and excludes pending review from completed counts", () => {
    assert.match(sprintActionsSource, /\bt\.completed_at\b/);
    assert.match(sprintActionsSource, /st\.review_status <> 'pending'/);
    const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/db/schema/index.ts"), "utf8");
    assert.match(schema, /completedAt: timestamp\("completed_at"/);
  });
});
