import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project files-workspace tab eliminates duplicate header and redundant cards, rendering 1 canonical SettingsCard", () => {
    const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

    // 1. SectionHeader is suppressed on files-workspace tab to avoid duplicate title
    assert.match(
        settingsTab,
        /id="project-settings-files-workspace"/,
        "SectionHeader must be suppressed on files-workspace tab to avoid duplicate title",
    );

    // 2. Extract files-workspace section block
    const filesWorkspaceBlock =
        settingsTab.split('id="project-settings-files-workspace"')[1]?.split(/id="project-settings-(?:readme|notifications)"/)[0] ?? "";
    assert.ok(filesWorkspaceBlock.length > 0, "files-workspace settings block must exist in ProjectSettingsTab");

    // 3. Redundant SummaryCard, separate Bulk card, separate Enforced policy card, and outer AdvancedDisclosure removed
    assert.doesNotMatch(
        filesWorkspaceBlock,
        /<SummaryCard/,
        "Redundant SummaryCard must be removed from files-workspace tab",
    );
    assert.doesNotMatch(
        filesWorkspaceBlock,
        /<AdvancedDisclosure/,
        "Outer AdvancedDisclosure must be removed from files-workspace tab",
    );
    assert.doesNotMatch(
        filesWorkspaceBlock,
        /title="Member upload permissions"/,
        "Fragmented Member upload permissions card must be removed",
    );
    assert.doesNotMatch(
        filesWorkspaceBlock,
        /title="Bulk upload control"/,
        "Fragmented Bulk upload control card must be removed",
    );
    assert.doesNotMatch(
        filesWorkspaceBlock,
        /title="Enforced file behavior"/,
        "Fragmented Enforced file behavior card must be removed",
    );

    // 4. Exactly 1 canonical SettingsCard with title "Files and workspace"
    assert.match(
        filesWorkspaceBlock,
        /<SettingsCard[\s\S]*?title="Files and workspace"/,
        "Must render canonical Files and workspace SettingsCard",
    );
    const cardMatches = filesWorkspaceBlock.match(/<SettingsCard/g) || [];
    assert.equal(
        cardMatches.length,
        1,
        "files-workspace tab must render exactly 1 canonical SettingsCard instead of multiple fragmented cards",
    );

    // 5. Unified full-bleed footer with live telemetry and Refresh control
    assert.match(
        filesWorkspaceBlock,
        /footer=\{/,
        "SettingsCard must provide canonical full-bleed footer",
    );
    assert.match(
        filesWorkspaceBlock,
        /leaders always allowed/,
        "Footer must display leaders always allowed metric",
    );
    assert.match(
        filesWorkspaceBlock,
        /members enabled/,
        "Footer must display members enabled metric",
    );
    assert.match(
        filesWorkspaceBlock,
        /disabled/,
        "Footer must display disabled members metric",
    );
    assert.match(
        filesWorkspaceBlock,
        /<RefreshCw[\s\S]*?Refresh/,
        "Footer must include canonical Refresh button with RefreshCw icon",
    );
});

test("file permissions provide compact identity rows, server filters, pagination, and explicit bulk scope", () => {
    const members = source("src/components/projects/settings/FileWorkspaceMembers.tsx");
    assert.match(members, /<UserAvatar/);
    assert.match(members, /getProjectMemberRoleLabel/);
    assert.match(members, /label="Search file permissions"/);
    assert.match(members, /onFilterChange/);
    assert.match(members, /Load more members/);
    assert.match(members, /outside the current filter or loaded pages/);
    assert.match(members, /default for future members/);
    assert.match(members, /<ConfirmDialog/);
    assert.match(members, /member.uploadPermissionLocked/);
    assert.match(members, /disabled=\{disabled\}/);
    assert.match(members, /<SettingsSwitch/);
    assert.doesNotMatch(members, /zinc-|blue-/);
});

test("files-workspace permissions enforce optimistic in-memory updates for 1M+ scale", () => {
    const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

    // Single member toggle optimistic update
    const toggleDef =
        settingsTab.split("const handleToggleMemberFileUpload = useCallback")[1]?.split("const handleBulkFileUploadPermission")[0] ?? "";
    assert.ok(toggleDef.length > 0, "handleToggleMemberFileUpload definition must exist");
    assert.match(
        toggleDef,
        /setFileWorkspaceData\(\{[\s\S]*?members: nextMembers/,
        "handleToggleMemberFileUpload must update fileWorkspaceData optimistically before server mutation",
    );

    // Bulk toggle optimistic update
    const bulkDef =
        settingsTab.split("const handleBulkFileUploadPermission = useCallback")[1]?.split("const handleProjectNotificationPreset")[0] ?? "";
    assert.ok(bulkDef.length > 0, "handleBulkFileUploadPermission definition must exist");
    assert.match(
        bulkDef,
        /setFileWorkspaceData\(\{[\s\S]*?members: nextMembers/,
        "handleBulkFileUploadPermission must update fileWorkspaceData optimistically before server mutation",
    );
});
