import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

const ROOT = process.cwd();

test("Empty state architectural contract: global CSS ground and typography definitions", () => {
    const cssSource = readFileSync(resolve(ROOT, "src/app/globals.css"), "utf-8");

    // 1. Blueprint drafting grid built directly into .nb-empty-state
    assert.match(cssSource, /\.nb-empty-state\s*\{[^}]*linear-gradient\(to right,var\(--nb-grid-line\)\s*1px,transparent 1px\)/);
    assert.match(cssSource, /\.nb-empty-state\s*\{[^}]*background-size:24px 24px/);

    // 2. Dedicated helper classes for titles, descriptions, and icon wells
    assert.match(cssSource, /\.nb-empty-state-title\s*\{[^}]*font-size:17px/);
    assert.match(cssSource, /\.nb-empty-state-desc,\s*\.nb-empty-state-description\s*\{[^}]*font-size:13px/);
    assert.match(cssSource, /\.nb-empty-state-icon-box\s*\{[^}]*width:40px;\s*height:40px/);
});

test("Empty state architectural contract: Workspace surfaces", () => {
    const tasksTab = readFileSync(resolve(ROOT, "src/components/my-work/MyWorkTasksTab.tsx"), "utf-8");

    assert.match(tasksTab, /className=["'][^"']*nb-empty-state nb-grid-ground/);
});

test("Empty state architectural contract: My profile surfaces", () => {
    const projectsGrid = readFileSync(resolve(ROOT, "src/components/profile/v2/sections/WorkspacesGridCard.tsx"), "utf-8");
    const contributions = readFileSync(resolve(ROOT, "src/components/profile/v2/sections/ContributionTimeline.tsx"), "utf-8");
    const connectionsModal = readFileSync(resolve(ROOT, "src/components/profile/v2/UserConnectionsModal.tsx"), "utf-8");
    const editProfileTabs = readFileSync(resolve(ROOT, "src/components/profile/edit/EditProfileTabs.tsx"), "utf-8");

    assert.match(projectsGrid, /<EmptyState[\s\S]*?title="No workspaces yet"/);
    assert.match(contributions, /className="nb-pf-empty"/);
    assert.match(connectionsModal, /className=["'][^"']*nb-empty-state nb-grid-ground/);
    assert.match(editProfileTabs, /className=["'][^"']*nb-empty-state nb-grid-ground/);
});

test("Empty state architectural contract: Projects and Tasks surfaces", () => {
    const docTab = readFileSync(resolve(ROOT, "src/components/workspaces/tabs/DocTab.tsx"), "utf-8");
    const sprintPlanning = readFileSync(resolve(ROOT, "src/components/workspaces/tabs/SprintPlanning.tsx"), "utf-8");
    const sprintTimeline = readFileSync(resolve(ROOT, "src/components/workspaces/tabs/sprint/SprintTimelineContent.tsx"), "utf-8");
    const updatesTab = componentSource("src/components/workspaces/tabs/UpdatesTab.tsx");
    const subtasksTab = readFileSync(resolve(ROOT, "src/components/workspaces/v2/tasks/TaskDetailTabs/SubtasksTab.tsx"), "utf-8");
    const commentsTab = readFileSync(resolve(ROOT, "src/components/workspaces/v2/tasks/TaskDetailTabs/CommentsTab.tsx"), "utf-8");
    const explorerTree = readFileSync(resolve(ROOT, "src/components/workspaces/v2/explorer/ExplorerTree.tsx"), "utf-8");
    const fileTreeItem = readFileSync(resolve(ROOT, "src/components/workspaces/v2/explorer/FileTreeItem.tsx"), "utf-8");
    const versionHistory = readFileSync(resolve(ROOT, "src/components/workspaces/v2/files-tab/file/FileVersionHistoryPanel.tsx"), "utf-8");
    const taskFilesExplorer = readFileSync(resolve(ROOT, "src/components/workspaces/v2/tasks/components/TaskFilesExplorer.tsx"), "utf-8");
    const taskSearchPicker = readFileSync(resolve(ROOT, "src/components/workspaces/v2/files-tab/picker/TaskSearchPicker.tsx"), "utf-8");

    assert.match(docTab, /className=["'][^"']*nb-empty-state nb-grid-ground/);
    assert.match(sprintPlanning, /className=["'][^"']*nb-empty-state nb-grid-ground/);
    assert.match(sprintTimeline, /className=["'][^"']*nb-empty-state nb-grid-ground/);
    assert.match(updatesTab, /className=["'][^"']*nb-empty-state nb-grid-ground/);
    assert.match(subtasksTab, /className=["'][^"']*nb-empty-state nb-grid-ground/);
    assert.match(commentsTab, /className=["'][^"']*nb-empty-state nb-grid-ground/);
    assert.match(explorerTree, /className=["'][^"']*nb-empty-state nb-grid-ground/);
    assert.match(fileTreeItem, /className=["'][^"']*nb-empty-state nb-grid-ground/);
    assert.match(versionHistory, /className=["'][^"']*nb-empty-state nb-grid-ground/);
    assert.match(taskFilesExplorer, /nb-grid-ground/);
    assert.match(taskSearchPicker, /className=["'][^"']*nb-empty-state nb-grid-ground/);
});

test("Empty state architectural contract: Discover, People, and Skills surfaces", () => {
    const hubClient = readFileSync(resolve(ROOT, "src/components/discover/DiscoverClient.tsx"), "utf-8");
    const skillPicker = readFileSync(resolve(ROOT, "src/components/skills/SkillPicker.tsx"), "utf-8");

    // Discover's empty states are the shared EmptyState (which renders .nb-empty-state.nb-grid-ground).
    assert.match(hubClient, /<EmptyState\b/);
    assert.match(skillPicker, /className=["'][^"']*nb-empty-state nb-grid-ground/);
});
