import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { componentSource } from "./_helpers/component-source";

const cwd = process.cwd();
function source(path: string): string {
    return readFileSync(resolve(cwd, path), "utf8");
}

test("project settings eliminates Security & Data tab completely and standardizes Privacy", () => {
    const policies = source("src/lib/projects/settings-policies.ts");
    const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

    // 1. Security & Data completely removed from PROJECT_SETTINGS_SECTIONS and ProjectSettingsTab
    assert.doesNotMatch(
        policies,
        /id:\s*"security-audit"/,
        "security-audit must be removed from PROJECT_SETTINGS_SECTIONS",
    );
    assert.doesNotMatch(
        policies,
        /Security & Data/,
        "Security & Data label must be removed from PROJECT_SETTINGS_SECTIONS",
    );
    assert.doesNotMatch(
        settingsTab,
        /id="project-settings-security-audit"/,
        "security-audit section render block must be removed from ProjectSettingsTab",
    );
    assert.doesNotMatch(
        settingsTab,
        /SettingsAuditTimeline/,
        "SettingsAuditTimeline must be removed from ProjectSettingsTab",
    );

    // 2. Privacy & Policies standardized to match main settings
    assert.match(
        policies,
        /id:\s*"privacy-policies"/,
        "privacy-policies must be defined in PROJECT_SETTINGS_SECTIONS",
    );
    assert.match(
        policies,
        /label:\s*"Privacy"/,
        "Privacy must be the label in PROJECT_SETTINGS_SECTIONS",
    );
    assert.match(
        settingsTab,
        /"privacy-policies": Scale/,
        "privacy-policies must use the Scale icon matching main settings",
    );
    assert.match(
        settingsTab,
        /<LegalAndDataRightsSection \/>/,
        "Must render LegalAndDataRightsSection for Privacy",
    );
});

test("project danger zone tab is redesigned into 1 canonical SettingsCard with live preflight telemetry", () => {
    const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

    // 1. Redundant SummaryCard, standalone Preflight card, and DangerAction wrappers removed
    const dangerBlock =
        settingsTab.split('id="project-settings-danger"')[1]?.split('</SettingsCard>')[0] ?? "";
    assert.ok(dangerBlock.length > 0, "Organization management settings block must exist in ProjectSettingsTab");

    assert.doesNotMatch(
        dangerBlock,
        /<SummaryCard/,
        "Redundant SummaryCard must be eliminated from Workspace management",
    );
    assert.doesNotMatch(
        dangerBlock,
        /<DangerAction/,
        "Old DangerAction wrapper must be removed from Workspace management",
    );

    // 2. Contains 1 canonical SettingsCard with danger prop
    assert.match(
        dangerBlock,
        /title="Workspace management"/,
        "Must render canonical SettingsCard with title Workspace management",
    );
    assert.match(
        dangerBlock,
        /danger/,
        "Must have danger styling enabled on SettingsCard",
    );

    // 3. Three core operations cleanly presented: Archive, Transfer Ownership, Delete
    assert.match(dangerBlock, /Archive this project/, "Must present Archive project operation");
    assert.match(dangerBlock, /Transfer ownership/, "Must present Transfer ownership operation");
    assert.match(dangerBlock, /Delete this project/, "Must present Delete project operation");

    // 4. Section 10 badge contracts and control standards
    assert.match(dangerBlock, /font-mono text-\[11px\]/, "Must use Section 10 badge typography");
    assert.match(dangerBlock, /rounded-\[3px\]/, "Must use Section 10 badge 3px radius");
    assert.match(dangerBlock, /rounded-\[5px\]/, "Must use Section 05 control 5px radius");
    assert.match(dangerBlock, /h-\[34px\]/, "Must use Section 05 desktop control height 34px");

    // 5. Preflight live telemetry in footer with Refresh checks button
    assert.match(dangerBlock, /preflightPolicy\.affectedAreas/, "Footer must show live preflight telemetry");
    assert.match(dangerBlock, /Refresh checks/, "Footer must provide Refresh checks button");
});

test("project danger zone enforces high-stakes verification barriers for ownership transfer and project deletion", () => {
    const modalsSource = source("src/components/projects/settings/ProjectDangerModals.tsx");
    const settingsTab = componentSource("src/components/projects/tabs/ProjectSettingsTab.tsx");

    // 1. Modals mounted in ProjectSettingsTab
    assert.match(settingsTab, /<ProjectArchiveModal/, "Must mount ProjectArchiveModal in ProjectSettingsTab");
    assert.match(settingsTab, /<ProjectTransferOwnershipModal/, "Must mount ProjectTransferOwnershipModal in ProjectSettingsTab");
    assert.match(settingsTab, /<ProjectDeleteModal/, "Must mount ProjectDeleteModal in ProjectSettingsTab");

    // 2. Transfer Ownership Modal verification barrier
    assert.match(modalsSource, /ProjectTransferOwnershipModal/, "Must export ProjectTransferOwnershipModal");
    assert.match(modalsSource, /OWNER ONLY/, "Must display OWNER ONLY authority badge");
    assert.match(modalsSource, /STEP-UP PROTECTED/, "Must display STEP-UP PROTECTED badge");
    assert.match(modalsSource, /getProjectMemberRoleLabel/, "Must review recipient role");
    assert.match(modalsSource, /become an <strong>admin<\/strong>/, "Must state clear demotion consequence");
    assert.match(modalsSource, /confirmInput\.trim\(\)\.toLowerCase\(\)\s*===\s*verificationTarget\.toLowerCase\(\)/, "Must enforce type-to-confirm barrier for transfer");

    // 3. Delete Project Modal verification barrier
    assert.match(modalsSource, /ProjectDeleteModal/, "Must export ProjectDeleteModal");
    assert.match(modalsSource, /PERMANENT/, "Must display PERMANENT badge");
    assert.match(modalsSource, /IRREVERSIBLE/, "Must display IRREVERSIBLE badge");
    assert.match(modalsSource, /ACTIVE TASKS/, "Must show active tasks impact");
    assert.match(modalsSource, /OPEN ROLES/, "Must show open roles impact");
    assert.match(modalsSource, /confirmInput\.trim\(\)\s*===\s*requiredSlug/, "Must enforce strict slug type-to-confirm barrier for delete");

    // 4. Geometry and typography standards
    assert.match(modalsSource, /rounded-\[12px\]/, "Modal content must use 12px panel radius");
    assert.match(modalsSource, /rounded-\[5px\]/, "Controls must use 5px control radius");
    assert.match(modalsSource, /rounded-\[3px\]/, "Badges must use 3px badge radius");
    assert.match(modalsSource, /h-\[34px\]/, "Action buttons must use 34px desktop height");
});

