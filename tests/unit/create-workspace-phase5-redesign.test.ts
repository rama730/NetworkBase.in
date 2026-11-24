import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('Phase 5 (v6) is a live review: one-line sections, changed-only, a sticky side with the real card and what Create does', () => {
    const phase = source('src/components/workspaces/create-wizard/phases/Phase5Review.tsx');

    assert.match(phase, /useWatch\(\{ control \}\)/);
    assert.match(phase, /step="Review" title=\{reviewReady \? 'Ready to create\.' : 'Almost there\.'\}/);
    for (const step of [1, 2, 3, 4]) assert.match(phase, new RegExp(`<ReviewSection step=\\{${step}\\}`));
    assert.match(phase, /data-review-line/);
    assert.match(phase, /Show only what I changed/);
    assert.match(phase, /Nothing changed from the defaults\./);
    assert.match(phase, /settingsChanges\(formData/);
    assert.match(phase, /Worth a look/);
    assert.match(phase, /data-review-side/);
    assert.match(phase, /<ProjectCard project=\{previewProject\}/);
    assert.match(phase, /<WorkspaceSearchResultCard /);
    assert.match(phase, /Exactly as it shows on Discover\./);
    assert.match(phase, /createSteps\(formData/);
    assert.match(phase, /keeps going if you leave/);
    assert.match(phase, /keep this tab open/);
    assert.match(phase, /Nothing is made until you press Create/);
    assert.doesNotMatch(phase, /border-l-2/);
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
    assert.match(footer, /const busy = isSubmitting \|\| isPhaseTransitioning;/);
    assert.match(footer, /disabled=\{busy \|\| !isReviewReady\}/);
    assert.match(modal, /<Phase5Review goToPhase=\{goToPhase\} onReady=\{handleReviewReady\} projectImage=\{projectImage\} \/>/);
});
