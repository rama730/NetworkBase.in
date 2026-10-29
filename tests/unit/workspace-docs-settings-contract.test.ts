import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project docs/readme tab eliminates duplicate header and redundant cards, rendering 1 canonical SettingsCard", () => {
    const settingsTab = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");

    // 1. SectionHeader is suppressed on readme tab to avoid duplicate title
    assert.match(
        settingsTab,
        /id="project-settings-readme"/,
        "SectionHeader must be suppressed on readme tab to avoid duplicate title",
    );

    // 2. Extract readme section block
    const readmeBlock =
        settingsTab.split('id="project-settings-readme"')[1]?.split('id="project-settings-updates"')[0] ?? "";
    assert.ok(readmeBlock.length > 0, "readme settings block must exist in ProjectSettingsTab");

    // 3. Redundant SummaryCard, fragmented cards, and outer AdvancedDisclosure removed
    assert.doesNotMatch(
        readmeBlock,
        /<SummaryCard/,
        "Redundant SummaryCard must be removed from readme/docs tab",
    );
    assert.doesNotMatch(
        readmeBlock,
        /<AdvancedDisclosure/,
        "Outer AdvancedDisclosure must be removed from readme/docs tab",
    );
    assert.doesNotMatch(
        readmeBlock,
        /title="Editing access"/,
        "Fragmented Editing access card must be consolidated into canonical card",
    );
    assert.doesNotMatch(
        readmeBlock,
        /title="Media, smart blocks, and notification policy"/,
        "Fragmented Media and smart blocks card must be consolidated into canonical card",
    );

    // 4. Exactly 1 canonical SettingsCard with title "Document publishing"
    assert.match(
        readmeBlock,
        /<SettingsCard[\s\S]*?title="Document publishing"/,
        "Must render canonical Document publishing SettingsCard",
    );
    const cardMatches = readmeBlock.match(/<SettingsCard/g) || [];
    assert.equal(
        cardMatches.length,
        1,
        "Must have exactly 1 canonical SettingsCard in readme settings tab",
    );

    // 5. Entire editing access policy removed (no radio buttons, no Members can edit, no Editing Access Policy card)
    assert.doesNotMatch(
        readmeBlock,
        /Editing Access Policy/,
        "Editing Access Policy section must be removed",
    );
    assert.doesNotMatch(
        readmeBlock,
        /Authoring &amp; Editing Authority/,
        "Authoring & Editing Authority card must be removed",
    );
    assert.doesNotMatch(
        readmeBlock,
        /role="radio"/,
        "Radio buttons for editing access must be removed",
    );
    assert.doesNotMatch(
        readmeBlock,
        /Members can edit/,
        "Members can edit option must be removed",
    );

    // 7. Managed image uploads and Project smart blocks options removed
    assert.doesNotMatch(
        readmeBlock,
        /Managed image uploads/,
        "Managed image uploads option must be removed",
    );
    assert.doesNotMatch(
        readmeBlock,
        /Project smart blocks/,
        "Project smart blocks option must be removed",
    );

    // 8. Genuine configuration options retained
    assert.match(
        readmeBlock,
        /External images/,
        "External images configuration option must be retained",
    );
    assert.doesNotMatch(
        readmeBlock,
        /Notify on publish/,
        "Doc settings must not offer a publish notification that nothing sends",
    );
});

test("project docs settings and components adhere to NetworkBase drafting-table design tokens and switches", () => {
    const settingsTab = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");
    const readmeBlock =
        settingsTab.split('id="project-settings-readme"')[1]?.split('id="project-settings-updates"')[0] ?? "";

    // 1. Uses canonical SettingsSwitch instead of TogglePill
    assert.doesNotMatch(
        readmeBlock,
        /<TogglePill/,
        "Must not use non-canonical TogglePill in readme tab",
    );
    assert.match(
        readmeBlock,
        /<SettingsSwitch/,
        "Must use canonical SettingsSwitch for intake toggles in readme tab",
    );

    // 2. Toggles apply immediately; Save changes and Cancel buttons are absent
    assert.doesNotMatch(
        readmeBlock,
        /Save changes/,
        "Must not render Save changes button in Document publishing card; toggles apply immediately",
    );
    assert.doesNotMatch(
        readmeBlock,
        /Cancel/,
        "Must not render Cancel button in Document publishing card; toggles apply immediately",
    );
    assert.match(
        readmeBlock,
        /handleToggleReadmeSetting/,
        "Must wire handleToggleReadmeSetting for immediate auto-save on toggle",
    );

    // 3. Document delivery & security guarantees panel removed
    assert.doesNotMatch(
        readmeBlock,
        /Document Delivery &amp; Security Guarantees/,
        "Document delivery & security guarantees panel must be removed",
    );

    // 4. Check Smart Block & Reference Preview components for drafting tokens
    const smartBlock = source("src/components/workspaces/doc/WorkspaceDocSmartBlock.tsx");
    assert.doesNotMatch(
        smartBlock,
        /rounded-full/,
        "ProjectDocSmartBlock must not use circular rounded-full pills or buttons",
    );
    assert.match(
        smartBlock,
        /rounded-\[5px\]/,
        "ProjectDocSmartBlock must use drafting-table rounded-[5px] geometry",
    );

    const refPreview = source("src/components/workspaces/doc/WorkspaceDocReferencePreview.tsx");
    assert.doesNotMatch(
        refPreview,
        /rounded-full/,
        "ProjectDocReferencePreview must not use circular rounded-full avatars or badges",
    );
    assert.match(
        refPreview,
        /rounded-\[5px\] border border-border/,
        "ProjectDocReferencePreview avatars must use drafting-table rounded-[5px] squared geometry",
    );
    assert.match(
        refPreview,
        /rounded-\[3px\][\s\S]*?font-mono text-\[11px\] uppercase tracking-\[0\.09em\]/,
        "ProjectDocReferencePreview must use Section 10 contract for badges",
    );

});
