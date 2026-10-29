import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('Phase 5 is a complete, live review including every step 4 launch setting', () => {
    const phase = source('src/components/workspaces/create-wizard/phases/Phase5Review.tsx');

    assert.match(phase, /useWatch\(\{ control \}\)/);
    assert.match(phase, /Step 5 · Review/);
    assert.match(phase, /Review before creating/);
    assert.match(phase, /eyebrow="Step 1"/);
    assert.match(phase, /eyebrow="Step 2"/);
    assert.match(phase, /eyebrow="Step 3"/);
    assert.match(phase, /eyebrow="Step 4"/);
    assert.match(phase, /Workspace journey/);
    assert.match(phase, /Workspace links/);
    assert.match(phase, /min-w-0 w-full space-y-8 pb-6/);
    assert.doesNotMatch(phase, /max-w-4xl/);
    assert.match(phase, /Nothing has been created yet/);
    assert.match(phase, /Nothing is created until you select Create workspace/);
    // Step 4 now chooses the starter doc, so Review shows it (as "Documentation"), plus the other launch settings.
    for (const label of ['Workspace picture', 'Visibility', 'Workspace links', 'Documentation', 'Workspace journey', 'Team permissions', 'Files and storage', 'Notifications']) {
        assert.match(phase, new RegExp(`label="${label}"`));
    }
    assert.doesNotMatch(phase, /Collaborator availability/);
});

test('entering review cannot create a project until the review is ready and the final action is explicit', () => {
    const wizard = source('src/components/workspaces/create-wizard/useCreateWorkspaceWizard.ts');
    const footer = source('src/components/workspaces/create-wizard/WizardFooter.tsx');
    const modal = source('src/components/workspaces/create-wizard/CreateWorkspaceWizard.tsx');

    assert.match(wizard, /phaseTransitionRef/);
    assert.match(wizard, /setTimeout\(releaseTransition, 350\)/);
    assert.match(wizard, /const \[isReviewReady, setIsReviewReady\] = useState\(false\)/);
    assert.match(wizard, /phase !== TOTAL_PHASES \|\| !isReviewReady \|\| phaseTransitionRef\.current \|\| submissionRef\.current/);
    assert.match(wizard, /submissionRef\.current = true/);
    assert.match(footer, /Preparing review…/);
    assert.match(footer, /disabled=\{isSubmitting \|\| isPhaseTransitioning \|\| !isReviewReady\}/);
    assert.match(modal, /<Phase5Review goToPhase=\{goToPhase\} onReady=\{handleReviewReady\} projectImage=\{projectImage\} \/>/);
});
