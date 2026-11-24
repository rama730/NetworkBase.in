import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createWorkspaceSchema } from '../../src/lib/validations/workspace';

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('Phase 3 (v6) lays the team out in frames: Owner, Open roles with a composer, and the org frames', () => {
    const phase = source('src/components/workspaces/create-wizard/phases/Phase3TeamRoles.tsx');

    assert.match(phase, /<PhaseHead noun="workspace" step="Team" title="Who’s building it\?"/);
    assert.match(phase, /className="nbs-frame"/);
    assert.match(phase, /'Owner and lead' : 'Owner'/);
    assert.match(phase, /Open roles/);
    assert.match(phase, /No openings yet/);
    assert.match(phase, /className="nb-composer"/);
    assert.match(phase, /<WorkspaceLeadRow \/>/);
    assert.match(phase, /<NotInTeamFrame \/>/);
    assert.match(phase, /<InheritedAdminRows \/>/);
    assert.doesNotMatch(phase, /border-dashed/);
    assert.doesNotMatch(phase, /<datalist/);
    assert.doesNotMatch(phase, /<details/);
});

test('Phase 3 (v6) role editor: Basics, Requirements, Offer, People, one action bar, accessible validation', () => {
    const phase = source('src/components/workspaces/create-wizard/phases/Phase3TeamRoles.tsx');

    assert.match(phase, /htmlFor="create-project-lead-focus"/);
    assert.match(phase, /<CharCount value=\{leadFocus\.length\} max=\{80\}/);
    assert.match(phase, /aria-invalid=\{Boolean\(roleError\?\.role \|\| duplicateRoleMessage\)\}/);
    assert.match(phase, /This matches role \$\{dup \+ 1\}\. Use one role per title\./);
    for (const group of ['Basics', 'Requirements', 'Offer']) assert.match(phase, new RegExp(`nbs-glabel[^>]*>${group}<`));
    assert.match(phase, /Experience level/);
    assert.match(phase, /Compensation details/);
    assert.match(phase, /typeProfile\(org\.orgType\)\.showCompensation/);
    assert.match(phase, /is a class, so its roles don’t show pay\./);
    assert.match(phase, /<UnitPeople index=\{index\}/);
    assert.match(phase, /Remove role/);
    assert.match(phase, /Duplicate/);
    assert.match(phase, /saved as you type/);
    assert.match(phase, /data-role-grip/);
    assert.match(phase, /Complete or remove the unfinished roles/);
});

test('Phase 3 roles participate in form drafts, validation, and final project creation', () => {
    const wizard = source('src/components/workspaces/create-wizard/useCreateWorkspaceWizard.ts');
    const modal = source('src/components/workspaces/create-wizard/CreateWorkspaceWizard.tsx');
    const schema = source('src/lib/validations/workspace.ts');
    const review = source('src/components/workspaces/create-wizard/phases/Phase5Review.tsx');

    assert.match(wizard, /useFieldArray/);
    assert.match(wizard, /name: 'roles'/);
    assert.match(wizard, /roles: \[\]/);
    assert.match(wizard, /trigger\(\['creator_role', 'roles'\], \{ shouldFocus: true \}\)/);
    assert.match(wizard, /const resolvedRoles = \(data\.roles \|\| \[\]\)/);
    assert.match(wizard, /phase3ValidationAttempted/);
    assert.match(modal, /showValidationSummary=\{phase3ValidationAttempted\}/);
    assert.match(schema, /max\(10, 'Up to 10 people per role'\)/);
    assert.match(schema, /Each open role needs a unique title\./);
    assert.match(review, /openPositionCount/);
    assert.match(review, /<DetailLabel>\{role\.count\}/);
});

test('Phase 3 rejects duplicate role titles before the workspace can be created', () => {
    const result = createWorkspaceSchema.safeParse({
        title: 'Product collaboration space',
        description: 'A clear project description that meets the minimum validation length.',
        project_type: 'web_app',
        roles: [
            { role: 'Frontend developer', count: 1 },
            { role: ' frontend developer ', count: 2 },
        ],
    });

    assert.equal(result.success, false);
    if (!result.success) {
        assert.ok(result.error.issues.some((issue) => issue.path.join('.') === 'roles.1.role' && issue.message === 'Each open role needs a unique title.'));
    }
});
