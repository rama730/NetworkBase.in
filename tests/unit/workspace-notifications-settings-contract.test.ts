import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project notifications tab eliminates duplicate header and redundant cards, rendering 1 canonical SettingsCard with 7 category dropdown triggers", () => {
    const settingsTab = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");

    // 1. SectionHeader is suppressed on notifications tab to avoid duplicate title
    assert.match(
        settingsTab,
        /id="project-settings-notifications"/,
        "SectionHeader must be suppressed on notifications tab to avoid duplicate title",
    );

    // 2. Extract notifications section block
    const notifBlock =
        settingsTab.split('id="project-settings-notifications"')[1]?.split('id="project-settings-privacy-policies"')[0] ?? "";
    assert.ok(notifBlock.length > 0, "notifications settings block must exist in ProjectSettingsTab");

    // 3. Redundant SummaryCard, fragmented split cards, and outer AdvancedDisclosure removed
    assert.doesNotMatch(
        notifBlock,
        /<SummaryCard/,
        "Redundant SummaryCard must be removed from notifications tab",
    );
    assert.doesNotMatch(
        notifBlock,
        /<AdvancedDisclosure/,
        "Outer AdvancedDisclosure must be removed from notifications tab",
    );
    assert.doesNotMatch(
        notifBlock,
        /Affected notification surfaces/,
        "Static Affected notification surfaces disclosure must be removed",
    );

    // 4. Baseline Presets section removed completely per user specification
    assert.doesNotMatch(
        notifBlock,
        /Baseline Presets/,
        "Baseline Presets section must be removed entirely",
    );
    assert.doesNotMatch(
        notifBlock,
        /<ProjectNotificationPresetButton/,
        "ProjectNotificationPresetButton must not be rendered in notifications tab",
    );

    // 5. Member-Level Preferences overview card removed per user specification
    assert.doesNotMatch(
        notifBlock,
        /Member-Level Preferences/,
        "Member-Level Preferences section must be removed from notifications tab",
    );

    // 6. Category filter pills replaced by 7 category dropdown triggers
    assert.doesNotMatch(
        notifBlock,
        /All Triggers/,
        "Filter rail with All Triggers must be replaced by 7 direct category triggers",
    );

    // 7. Exactly 1 canonical SettingsCard with title "Workspace notification policy"
    assert.match(
        notifBlock,
        /<SettingsCard[\s\S]*?title="Workspace notification policy"/,
        "Must render canonical Workspace notification policy SettingsCard",
    );
    const cardMatches = notifBlock.match(/<SettingsCard/g) || [];
    assert.equal(
        cardMatches.length,
        1,
        "Must have exactly 1 canonical SettingsCard in notifications settings tab",
    );

    // 8. Workflow Event Triggers section with 7 category dropdown cards
    assert.match(
        notifBlock,
        /Workflow Event Triggers/,
        "Workflow Event Triggers section must be present",
    );
    assert.match(
        notifBlock,
        // Organizations map their own longer list (report §26.8); projects keep NOTIFICATION_GROUPS.
        /(NOTIFICATION_GROUPS|notificationGroups)\.map/,
        "Must map the 7 notification workflow categories",
    );
    assert.match(
        notifBlock,
        /<ProjectNotificationCategoryCard/,
        "Must render ProjectNotificationCategoryCard for each workflow category",
    );
    assert.match(
        settingsTab,
        /aria-expanded=\{isExpanded\}/,
        "Category trigger must have accessible aria-expanded attribute",
    );

    // 9. Bulk Expand all / Collapse all action present
    assert.match(
        notifBlock,
        /areAllNotificationGroupsExpanded \? "Collapse all" : "Expand all"/,
        "Must provide bulk Expand all / Collapse all toggle button",
    );
});

test("project notifications settings adhere to NetworkBase drafting-table design tokens and switches", () => {
    const settingsTab = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");
    const notifBlock =
        settingsTab.split('id="project-settings-notifications"')[1]?.split('id="project-settings-privacy-policies"')[0] ?? "";

    // 1. Uses canonical SettingsSwitch instead of TogglePill
    assert.doesNotMatch(
        notifBlock,
        /<TogglePill/,
        "Must not use non-canonical TogglePill in notifications tab",
    );

    // 2. Section 10 badge contract applied
    assert.match(
        settingsTab,
        /rounded-\[3px\][\s\S]*?font-mono text-\[11px\] font-medium uppercase tracking-\[0\.09em\]/,
        "Must use Section 10 contract for badges in notifications tab",
    );
    assert.match(
        settingsTab,
        /\{enabledCount\}\/\{group\.entries\.length\} enabled/,
        "Category trigger must display its live enabled count",
    );

    // 3. Full-bleed footer with Save changes and Cancel buttons
    assert.match(
        notifBlock,
        /footer=\{[\s\S]*?<Button[\s\S]*?>[\s\S]*?Cancel[\s\S]*?<\/Button>[\s\S]*?<Button[\s\S]*?>[\s\S]*?Save changes[\s\S]*?<\/Button>/,
        "Must render card-level Cancel and Save changes buttons in full-bleed footer",
    );
    assert.match(
        notifBlock,
        /h-\[34px\] rounded-\[5px\] px-3\.5 text-\[13px\] font-medium/,
        "Footer buttons must use drafting-table h-[34px] rounded-[5px] tokens",
    );

    // 4. Zero raw zinc colors in notifications settings block
    assert.doesNotMatch(
        notifBlock,
        /zinc-/,
        "Must not use raw zinc- utility classes in notifications tab",
    );
});

test("project notification rule rows and member editor components use SettingsSwitch and semantic tokens", () => {
    const settingsTab = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");

    // ProjectNotificationRuleRow must use SettingsSwitch and not TogglePill
    const ruleRowBlock = settingsTab.split("function ProjectNotificationRuleRow(")[1]?.split("function MemberNotificationSettingsEditor(")[0] ?? "";
    assert.ok(ruleRowBlock.length > 0, "ProjectNotificationRuleRow must exist");
    assert.doesNotMatch(ruleRowBlock, /<TogglePill/, "ProjectNotificationRuleRow must not use TogglePill");
    assert.match(ruleRowBlock, /<SettingsSwitch/, "ProjectNotificationRuleRow must use canonical SettingsSwitch");
    assert.doesNotMatch(ruleRowBlock, /zinc-/, "ProjectNotificationRuleRow must not use raw zinc classes");

    // MemberNotificationSettingsEditor must use semantic tokens
    const memberEditorBlock = settingsTab.split("function MemberNotificationSettingsEditor(")[1]?.split("function AdvancedDisclosure(")[0] ?? "";
    assert.ok(memberEditorBlock.length > 0, "MemberNotificationSettingsEditor must exist");
    assert.doesNotMatch(memberEditorBlock, /<TogglePill/, "MemberNotificationRuleRow must not use TogglePill");
    assert.match(memberEditorBlock, /<SettingsSwitch/, "MemberNotificationRuleRow must use canonical SettingsSwitch");
    assert.doesNotMatch(memberEditorBlock, /zinc-/, "MemberNotificationSettingsEditor must not use raw zinc classes");
});
