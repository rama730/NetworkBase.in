import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("workspace updates tab eliminates duplicate header and redundant cards, rendering 1 canonical SettingsCard", () => {
    const settingsTab = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");

    // 1. SectionHeader is suppressed on updates tab to avoid duplicate title
    assert.match(
        settingsTab,
        /id="project-settings-updates"/,
        "SectionHeader must be suppressed on updates tab to avoid duplicate title",
    );

    // 2. Extract updates section block
    const updatesBlock =
        settingsTab.split('id="project-settings-updates"')[1]?.split('id="project-settings-tasks-workflow"')[0] ?? "";
    assert.ok(updatesBlock.length > 0, "updates settings block must exist in WorkspaceSettingsTab");

    // 3. Redundant SummaryCard, fragmented split cards, and outer AdvancedDisclosure removed
    assert.doesNotMatch(
        updatesBlock,
        /<SummaryCard/,
        "Redundant SummaryCard must be removed from updates tab",
    );
    assert.doesNotMatch(
        updatesBlock,
        /<AdvancedDisclosure/,
        "Outer AdvancedDisclosure must be removed from updates tab",
    );
    assert.doesNotMatch(
        updatesBlock,
        /title="Publishing rules"/,
        "Fragmented Publishing rules card must be consolidated into canonical card",
    );
    assert.doesNotMatch(
        updatesBlock,
        /title="Follower notifications"/,
        "Fragmented Follower notifications card must be consolidated into canonical card",
    );

    // 4. Exactly 1 canonical SettingsCard with title "Workspace updates"
    assert.match(
        updatesBlock,
        /<SettingsCard[\s\S]*?title="Workspace updates"/,
        "Must render canonical Workspace updates SettingsCard",
    );
    const cardMatches = updatesBlock.match(/<SettingsCard/g) || [];
    assert.equal(
        cardMatches.length,
        1,
        "Must have exactly 1 canonical SettingsCard in updates settings tab",
    );

    // 5. Genuine configuration options retained; unnecessary feed visibility & distribution removed per design spec
    assert.match(
        updatesBlock,
        /Allow members to post updates/,
        "Allow members to post updates toggle must be present",
    );
    assert.doesNotMatch(
        updatesBlock,
        /Feed Visibility &amp; Distribution/,
        "Feed Visibility & Distribution section must be removed",
    );
    assert.doesNotMatch(
        updatesBlock,
        /Public Feed Linkage/,
        "Public Feed Linkage info card must be removed",
    );
    assert.doesNotMatch(
        updatesBlock,
        /Follower Broadcasts/,
        "Follower Broadcasts info card must be removed",
    );
});

test("workspace updates settings adhere to NetworkBase drafting-table design tokens and switches", () => {
    const settingsTab = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");
    const updatesBlock =
        settingsTab.split('id="project-settings-updates"')[1]?.split('id="project-settings-tasks-workflow"')[0] ?? "";

    // 1. Uses canonical SettingsSwitch instead of TogglePill
    assert.doesNotMatch(
        updatesBlock,
        /<TogglePill/,
        "Must not use non-canonical TogglePill in updates tab",
    );
    assert.match(
        updatesBlock,
        /<SettingsSwitch/,
        "Must use canonical SettingsSwitch in updates tab",
    );

    // 2. Section 10 badge contract applied
    assert.match(
        updatesBlock,
        /aria-label="Allow members to post updates"/,
        "The publishing permission must have an accessible switch label",
    );

    // 3. Toggles apply immediately; Save changes and Cancel buttons are absent
    assert.doesNotMatch(
        updatesBlock,
        /Save changes/,
        "Must not render Save changes button in Workspace updates card; toggles apply immediately",
    );
    assert.doesNotMatch(
        updatesBlock,
        /Cancel/,
        "Must not render Cancel button in Workspace updates card; toggles apply immediately",
    );
    assert.match(
        updatesBlock,
        /handleToggleMemberUpdates/,
        "Must wire handleToggleMemberUpdates for immediate auto-save on toggle",
    );

    // 4. Zero raw zinc colors
    assert.doesNotMatch(
        updatesBlock,
        /zinc-/,
        "Must not use raw zinc- utility classes in updates tab",
    );
});

test("project dashboard client enforces memberUpdatesEnabled permission for authoring updates", () => {
    const dashboardClient = source("src/components/workspaces/dashboard/WorkspaceDashboardClient.tsx");

    // canCreateUpdates must inspect memberUpdatesEnabled
    assert.match(
        dashboardClient,
        /canCreateUpdates[\s\S]*?memberUpdatesEnabled/,
        "canCreateUpdates in WorkspaceDashboardClient must enforce memberUpdatesEnabled permission",
    );
});
