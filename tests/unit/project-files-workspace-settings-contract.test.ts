import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { projectSettingsSource } from "./_helpers/project-settings-source";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project files-workspace tab eliminates duplicate header and redundant cards, rendering 1 canonical SettingsCard", () => {
    const settingsTab = projectSettingsSource();

    // 1. SectionHeader is suppressed on files-workspace tab to avoid duplicate title
    assert.match(
        settingsTab,
        /activeSection !== "files-workspace"/,
        "SectionHeader must be suppressed on files-workspace tab to avoid duplicate title",
    );

    // 2. Extract files-workspace section block
    const filesWorkspaceBlock =
        settingsTab.split('activeSection === "files-workspace" && (')[1]?.split(/activeSection === "(?:readme|notifications)"/)[0] ?? "";
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

test("FileWorkspaceMembers adheres to two-section architecture, unified identity, Section 10 role badges, and drafting-table tokens", () => {
    const settingsTab = projectSettingsSource();

    // Extract FileWorkspaceMembers definition
    const membersDef =
        settingsTab.split("function FileWorkspaceMembers({")[1]?.split("function LifecycleSettingsEditor({")[0] ?? "";
    assert.ok(membersDef.length > 0, "FileWorkspaceMembers definition must exist");

    // 1. Two-section architecture: Project Leadership & Team Member Intake
    assert.match(
        membersDef,
        /Project Leadership/,
        "Must partition directory into Project Leadership sub-section",
    );
    assert.match(
        membersDef,
        /Team Member Intake/,
        "Must partition directory into Team Member Intake sub-section",
    );

    // 2. Search input and status filter tabs
    assert.match(
        membersDef,
        /aria-label="Search members by name or role"/,
        "Must provide accessible search input for members",
    );
    assert.match(
        membersDef,
        /role="tablist"[\s\S]*?aria-label="Filter members by upload status"/,
        "Must provide status filter tablist (All, Allowed, Paused)",
    );

    // 3. Bulk action dropdown with drafting-table tokens
    assert.match(
        membersDef,
        /Bulk actions/,
        "Must provide Bulk actions dropdown menu trigger",
    );
    assert.match(
        membersDef,
        /Enable all members/,
        "Must provide Enable all members bulk action",
    );
    assert.match(
        membersDef,
        /Disable all members/,
        "Must provide Disable all members bulk action",
    );

    // 4. Unified Identity: preserves both role title and @username
    assert.match(
        membersDef,
        /roleTitle && username/,
        "Must preserve both roleTitle and @username without hiding handle",
    );

    // 5. Uses squared UserAvatar (size 44, rounded-[5px], hairline border)
    assert.match(
        membersDef,
        /<UserAvatar[\s\S]*?identity=\{[\s\S]*?size=\{44\}[\s\S]*?roundedClassName="rounded-\[5px\]"[\s\S]*?border border-border/,
        "FileWorkspaceMembers must use squared UserAvatar with size 44, rounded-[5px], and border",
    );

    // 6. Section 10 role badges with role-based tokens
    assert.match(
        membersDef,
        /border-amber-500\/20 bg-amber-500\/10 text-amber-700/,
        "Owner/Lead badge must use warm amber token",
    );
    assert.match(
        membersDef,
        /border-primary\/20 bg-primary\/10 text-primary/,
        "Admin badge must use primary clay token",
    );
    assert.match(
        membersDef,
        /border-border bg-muted text-foreground/,
        "Member badge must use clean slate token",
    );
    assert.doesNotMatch(
        membersDef,
        /rounded-full/,
        "FileWorkspaceMembers must not use circular rounded-full badges",
    );

    // 7. Architectural status indicator for leaders
    assert.match(
        membersDef,
        /Always active · Lead policy/,
        "Must provide professional Always active · Lead policy indicator with Shield icon",
    );

    // 8. Explicit permission status for standard members
    assert.match(
        membersDef,
        /Upload allowed/,
        "Must provide explicit Upload allowed status",
    );
    assert.match(
        membersDef,
        /Upload paused/,
        "Must provide explicit Upload paused status",
    );
    assert.match(
        membersDef,
        /<SettingsSwitch/,
        "Toggleable members must use SettingsSwitch",
    );

    // 9. Storage Invariants & Intake Guarantees specification panel removed
    assert.doesNotMatch(
        membersDef,
        /Storage Invariants &amp; Intake Guarantees/,
        "Storage Invariants & Intake Guarantees spec panel must be removed",
    );

    // 10. Zero raw zinc or blue colors
    assert.doesNotMatch(
        membersDef,
        /zinc-/,
        "FileWorkspaceMembers must not use raw zinc classes",
    );
    assert.doesNotMatch(
        membersDef,
        /blue-/,
        "FileWorkspaceMembers must not use raw blue classes",
    );
});

test("files-workspace permissions enforce optimistic in-memory updates for 1M+ scale", () => {
    const settingsTab = projectSettingsSource();

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
