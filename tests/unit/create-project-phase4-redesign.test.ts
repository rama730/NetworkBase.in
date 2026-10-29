import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createProjectSchema } from '../../src/lib/validations/project';
import { projectActionsSource } from "./_project-actions-source";

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('Phase 4 uses the flat launch-settings hierarchy and removes creation-time Terms and IP', () => {
    const phase = source('src/components/projects/create-wizard/phases/Phase4Settings.tsx');
    const schema = source('src/lib/validations/project.ts');
    const wizard = source('src/components/projects/create-wizard/useCreateProjectWizard.ts');

    assert.match(phase, /Phase 4 · \{isOrganization \? 'setup' : 'settings'\}/);
    assert.match(phase, /Set up how the workspace launches/);
    assert.match(phase, /Choose workspace visibility/);
    // Roles are reviewed in step 5; step 4 is launch settings only.
    assert.doesNotMatch(phase, /Confirm the initial availability|Edit roles|Ready to review:/);
    assert.match(phase, /Workspace links/);
    assert.match(phase, /min-w-0 w-full space-y-8 pb-6/);
    assert.match(phase, /border-t border-border pt-6/);
    assert.match(phase, /type="radio"/);
    assert.match(phase, /rounded-\[3px\]/);
    assert.match(phase, /commitContext="project-create"/);
    assert.match(phase, /Visible at launch:/);
    assert.doesNotMatch(phase, /Terms & IP/);
    assert.doesNotMatch(schema, /termsSchema/);
    assert.doesNotMatch(schema, /applicationSettingsSchema/);
    assert.doesNotMatch(wizard, /application_settings:/);
    assert.doesNotMatch(wizard, /terms:/);

    const linkEditor = source('src/components/projects/dashboard/ProjectSocialLinksCard.tsx');
    assert.match(linkEditor, /commitContext\?: 'settings' \| 'project-create'/);
    assert.match(linkEditor, /saved when you create the workspace/);
    assert.match(linkEditor, /commitContext === 'settings' && saved/);
    assert.match(linkEditor, /rounded-lg border border-border bg-muted\/20 p-4 sm:p-5/);
    assert.match(linkEditor, /overflow-hidden rounded-lg border border-border bg-card/);
});

test('Phase 4 blocks unfinished link work and carries launch settings into review', () => {
    const phase = source('src/components/projects/create-wizard/phases/Phase4Settings.tsx');
    const wizard = source('src/components/projects/create-wizard/useCreateProjectWizard.ts');
    const modal = source('src/components/projects/create-wizard/CreateProjectWizard.tsx');
    const review = source('src/components/projects/create-wizard/phases/Phase5Review.tsx');

    assert.match(phase, /onPendingChange=\{onLinkComposerPending\}/);
    assert.match(phase, /Finish the workspace links before continuing/);
    assert.match(wizard, /phase4LinkComposerPending/);
    assert.match(wizard, /trigger\(\['visibility', 'external_links'\], \{ shouldFocus: true \}\)/);
    assert.match(modal, /showValidationSummary=\{phase4ValidationAttempted\}/);
    assert.match(modal, /projectImage=\{projectImage\} onProjectImageChange=\{setProjectImage\}/);
    assert.match(review, /Launch settings/);
    assert.match(review, /goToPhase\(4\)/);
    assert.match(review, /projectLinks/);
});

test('creation derives recruiting and open-role counts from valid submitted roles', () => {
    const action = projectActionsSource();

    assert.match(action, /const openRoles = \(input\.roles \|\| \[\]\)\.filter/);
    assert.match(action, /const lookingForCollaborators = openRoles\.length > 0/);
    assert.match(action, /lookingForCollaborators,/);
    assert.match(action, /openRolesCount: openRoles\.length/);
    assert.match(action, /openRoles\.map\(\(role\)/);
});

test('removed creation-time terms are safely omitted from parsed project input', () => {
    const result = createProjectSchema.parse({
        title: 'Launch-ready project',
        description: 'A sufficiently detailed description for project creation validation.',
        project_type: 'web_app',
        terms: { ip_agreement: 'shared' },
    });

    assert.equal('terms' in result, false);
});
