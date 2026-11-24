import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('Phase 2 uses the flat NetworkBase project-information composition', () => {
    const phase = source('src/components/workspaces/create-wizard/phases/Phase2Information.tsx');

    assert.match(phase, /<PhaseHead noun=\{orgCopy \? 'organization' : 'workspace'\} step=\{orgCopy \? 'Details' : 'Info'\} title="Name it, then explain it\."/);
    assert.match(phase, /Name and classify the workspace/);
    assert.match(phase, /Explain the work/);
    assert.match(phase, /Make the workspace easier to find/);
    // Journey stages moved to step 4 (Stages and workflow), matching Workspace settings.
    assert.doesNotMatch(phase, /Outline the stages ahead|LifecycleEditor/);
    assert.match(phase, /min-w-0 w-full space-y-8 pb-6/);
    assert.match(phase, /border-t border-border pt-6/);
    assert.doesNotMatch(phase, /rounded-lg border border-border bg-card p-6/);
});

test('Phase 2 fields expose density-aware controls, field labels, limits, and semantic errors', () => {
    const phase = source('src/components/workspaces/create-wizard/phases/Phase2Information.tsx');
    const wizard = source('src/components/workspaces/create-wizard/useCreateWorkspaceWizard.ts');
    const select = source('src/components/ui/select.tsx');

    assert.match(phase, /h-\[var\(--ui-control-height-lg\)\]/);
    assert.match(phase, /htmlFor="create-project-title"/);
    assert.match(phase, /aria-invalid=\{Boolean\(errors\.title\)\}/);
    assert.match(phase, /<CharCount value=\{title\.length\} max=\{100\}/);
    assert.match(phase, /<CharCount value=\{tagline\.length\} max=\{200\}/);
    assert.match(phase, /<CharCount value=\{description\.length\} max=\{5000\}/);
    assert.match(phase, /status-danger-soft/);
    assert.match(wizard, /setPhase2ValidationAttempted\(true\)/);
    assert.match(wizard, /trigger\(fieldsToValidate, \{ shouldFocus: true \}\)/);
    // Student check 2: selects sit above every dialog and drawer, the task panel (201) included.
    assert.match(select, /z-\[400\]/);
    assert.match(select, /w-full min-w-\[var\(--radix-select-trigger-width\)\]/);
    assert.doesNotMatch(select, /h-\[var\(--radix-select-trigger-height\)\]/);
});

test('Phase 2 preserves draft safety; step 4 reuses the canonical Settings lifecycle editor', () => {
    const phase = source('src/components/workspaces/create-wizard/phases/Phase2Information.tsx');
    const launch = source('src/components/workspaces/create-wizard/phases/Phase4Settings.tsx');
    const lifecycle = source('src/components/workspaces/LifecycleEditor.tsx');
    const skills = source('src/components/skills/SkillPicker.tsx');

    assert.match(phase, /setValue\('tags', \[\.\.\.tags, tag\], \{ shouldDirty: true, shouldValidate: true \}\)/);
    assert.match(launch, /set\('lifecycle_stages', stages\)/);
    assert.match(phase, /progressive/);
    assert.match(phase, /projectTagLimit = 8/);
    assert.match(phase, /font-mono text-\[11px\] uppercase tracking-\[0\.09em\]/);
    assert.doesNotMatch(phase, /variant="wizard"/);
    // No current-stage picker at creation: new workspaces start at the first stage.
    assert.match(launch, /showCurrentStage=\{false\}/);
    assert.doesNotMatch(launch, /Where is the workspace now|current_stage_index/);
    assert.match(lifecycle, /showCurrentStage\?: boolean/);
    assert.match(lifecycle, /showCurrentStage && index === liveCurrentIndex/);
    assert.doesNotMatch(lifecycle, /Earlier/);
    assert.doesNotMatch(lifecycle, /Later/);
    assert.match(lifecycle, /Drag stages using the grip handle to reorder the workspace roadmap timeline\./);
    assert.match(skills, /progressive = false/);
    assert.match(skills, /showCatalogControls/);
});
