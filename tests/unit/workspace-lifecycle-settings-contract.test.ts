import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { componentSource } from "./_helpers/component-source";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("project lifecycle tab eliminates duplicate header and redundant summary cards, rendering 1 canonical SettingsCard", () => {
    const settingsTab = componentSource("src/components/workspaces/tabs/WorkspaceSettingsTab.tsx");

    // 1. SectionHeader is suppressed on tasks-workflow tab
    assert.match(
        settingsTab,
        /id="project-settings-tasks-workflow"/,
        "SectionHeader must be suppressed on tasks-workflow tab to avoid duplicate title",
    );

    // 2. Extract tasks-workflow section block
    const workflowBlock =
        settingsTab.split('id="project-settings-tasks-workflow"')[1]?.split('id="project-settings-files-workspace"')[0] ?? "";
    assert.ok(workflowBlock.length > 0, "tasks-workflow settings block must exist in WorkspaceSettingsTab");

    // 3. Redundant SummaryCard must be removed
    assert.doesNotMatch(
        workflowBlock,
        /<SummaryCard/,
        "Redundant SummaryCard must be removed from Stages tab",
    );

    // 4. LifecycleSettingsEditor component definition inspection
    const editorDef =
        settingsTab.split("function LifecycleSettingsEditor({")[1]?.split("function AccessTransitionDetails({")[0] ?? "";
    assert.ok(editorDef.length > 0, "LifecycleSettingsEditor definition must exist");

    // 5. Exactly 1 canonical SettingsCard with title "Stages"
    assert.match(
        editorDef,
        /<SettingsCard[\s\S]*?title="Stages"/,
        "Must render canonical Stages SettingsCard",
    );

    // 6. Unified full-bleed footer with dirty state tracking, Cancel, and Save changes
    assert.match(
        editorDef,
        /footer=\{/,
        "SettingsCard must provide canonical footer",
    );
    assert.match(
        editorDef,
        /You have unsaved changes in lifecycle stages\./,
        "Footer must track unsaved changes dirty state",
    );
    assert.match(
        editorDef,
        /Save changes/,
        "Footer must provide canonical Save changes button",
    );
    assert.match(
        editorDef,
        /Cancel/,
        "Footer must provide canonical Cancel button",
    );

    // 7. No ad-hoc buttons inside card content
    assert.doesNotMatch(
        editorDef,
        /bg-indigo-600/,
        "Must not contain hardcoded indigo Save Lifecycle button",
    );
    assert.doesNotMatch(
        editorDef,
        /Save Lifecycle<\/Button>/,
        "Must not contain legacy ad-hoc Save Lifecycle button inside body",
    );

    // 8. Guidance callout present with semantic tokens
    assert.match(
        editorDef,
        /nb-ui-label text-foreground">Stages</,
        "Must render the stages guidance callout",
    );
    assert.match(
        editorDef,
        /border-b border-border pb-4/,
        "Guidance callout must use semantic drafting-table tokens",
    );
});

test("LifecycleEditor adheres to NetworkBase drafting-table design tokens, canonical labels, and drag-and-drop standards", () => {
    const editorSource = source("src/components/workspaces/LifecycleEditor.tsx");

    // 1. Canonical design specification labels (nb-ui-label and nb-compact)
    assert.match(
        editorSource,
        /className="nb-ui-label text-foreground">[\s\S]*?Add stage/,
        "Add stage input must have canonical nb-ui-label",
    );
    assert.match(
        editorSource,
        /<h5 className="nb-ui-label font-semibold text-foreground">Workspace journey stages<\/h5>/,
        "Stages list must have canonical nb-ui-label section header",
    );
    assert.match(
        editorSource,
        /nb-compact/,
        "Must include nb-compact helper descriptions",
    );
    assert.match(
        editorSource,
        /divide-y divide-border/,
        "Must use divide-y divide-border between Add Stage form and Stages list",
    );

    // 2. Control heights and radii: 34px standard desktop, 5px control radius per Section 05 & 10
    assert.match(
        editorSource,
        /h-\[34px\] flex-1 rounded-\[5px\] border border-border bg-card px-3 text-\[13px\] leading-\[1\.5\]/,
        "Add stage input must use canonical 34px height, 5px radius, and 13px/1.5 typography",
    );
    assert.match(
        editorSource,
        /h-\[34px\] gap-1\.5 rounded-\[5px\] px-3\.5 text-\[13px\] font-medium leading-\[1\.2\]/,
        "Add stage button must use canonical 34px height, 5px radius, and 13px medium typography",
    );

    // 3. Semantic card tokens for stage items
    assert.match(
        editorSource,
        /border-border/,
        "Must use border-border token",
    );
    assert.match(
        editorSource,
        /bg-card/,
        "Must use bg-card token",
    );
    assert.match(
        editorSource,
        /border-primary\/40 bg-primary\/\[0\.03\] ring-1 ring-primary\/20/,
        "Active stage must use primary tokens",
    );

    // 4. Current badge tokens: 20px height, 7px padding, 3px radius, 11px uppercase mono per Section 10
    assert.match(
        editorSource,
        /h-5 px-\[7px\] rounded-\[3px\] border border-primary\/20 bg-primary\/10 font-mono text-\[11px\] font-medium uppercase tracking-\[0\.09em\] text-primary/,
        "Current stage badge must use Section 10 canonical badge contract (20px, 7px pad, 3px radius, 11px uppercase mono)",
    );
    assert.doesNotMatch(
        editorSource,
        /rounded-full/,
        "LifecycleEditor must not use circular rounded-full badges",
    );

    // 5. Stage index node: small status node with 3px radius per Section 30
    assert.match(
        editorSource,
        /rounded-\[3px\] border border-border\/80 bg-muted\/40 font-mono text-\[11px\] font-medium tabular-nums text-muted-foreground/,
        "Must render small status node with 3px radius and tabular mono digits",
    );

    // 6. Inline editable input with 5px radius and 13px/1.5 typography
    assert.match(
        editorSource,
        /h-\[28px\] flex-1 rounded-\[5px\] border border-transparent bg-transparent px-2 text-\[13px\] font-medium leading-\[1\.5\]/,
        "Stage row input must use 28px compact height, 5px radius, and 13px/1.5 typography",
    );

    // 7. Remove icon button: 28px (size-7) with 5px radius per Section 10
    assert.match(
        editorSource,
        /inline-flex size-7 shrink-0 items-center justify-center rounded-\[5px\] text-muted-foreground/,
        "Remove button must use Section 10 icon button standard (28px square, 5px radius)",
    );

    // 5. Drag-and-drop reordering without redundant chevron up/down buttons
    assert.match(
        editorSource,
        /GripVertical/,
        "Must include GripVertical drag handle for reordering",
    );
    assert.doesNotMatch(
        editorSource,
        /ChevronUp/,
        "ChevronUp button must be removed as drag-and-drop handles reordering",
    );
    assert.doesNotMatch(
        editorSource,
        /ChevronDown/,
        "ChevronDown button must be removed as drag-and-drop handles reordering",
    );

    // 6. Accessible remove button with guard
    assert.match(
        editorSource,
        /aria-label=\{`Remove \$\{stage\} stage`\}/,
        "Must include accessible aria-label for removing stage",
    );
    assert.match(
        editorSource,
        /stages\.length <= 1/,
        "Must prevent deleting the last remaining stage",
    );

    // 7. No raw untokenized classes
    assert.doesNotMatch(
        editorSource,
        /indigo-/,
        "LifecycleEditor must not contain raw indigo classes",
    );
    assert.doesNotMatch(
        editorSource,
        /zinc-/,
        "LifecycleEditor must not contain raw zinc classes",
    );
});
