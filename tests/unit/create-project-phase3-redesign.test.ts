import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createProjectSchema } from '../../src/lib/validations/project';

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('Phase 3 uses the canonical wizard hierarchy and flat team composition', () => {
    const phase = source('src/components/projects/create-wizard/phases/Phase3TeamRoles.tsx');

    assert.match(phase, /Phase 3 · team/);
    assert.match(phase, /Build the initial team/);
    assert.match(phase, /title="Owner"/);
    assert.match(phase, /Set up your team/);
    assert.match(phase, /min-w-0 w-full space-y-8 pb-6/);
    assert.match(phase, /border-t border-border pt-6/);
    assert.match(phase, /No openings added/);
    assert.doesNotMatch(phase, /border-dashed/);
    assert.doesNotMatch(phase, /<datalist/);
});

test('Phase 3 exposes accessible, progressive role controls and inline validation', () => {
    const phase = source('src/components/projects/create-wizard/phases/Phase3TeamRoles.tsx');

    assert.match(phase, /htmlFor="create-project-lead-focus"/);
    assert.match(phase, /\{leadFocus\.length\}\/80/);
    assert.match(phase, /aria-invalid=\{Boolean\(roleError\?\.role \|\| duplicateRoleMessage\)\}/);
    assert.match(phase, /Role requirements and offer/);
    assert.match(phase, /bg-secondary\/55/);
    assert.match(phase, /<ChevronDown/);
    assert.match(phase, /group-open:rotate-180/);
    assert.match(phase, /<SkillPicker/);
    assert.match(phase, /Experience level/);
    assert.match(phase, /Compensation details/);
    assert.match(phase, /font-mono text-\[11px\] uppercase tracking-\[0\.09em\]/);
    assert.match(phase, /Complete or remove the unfinished roles/);
    assert.match(phase, /Popular roles/);
    assert.match(phase, /Required details complete/);
    assert.match(phase, /Add another role/);
    assert.match(phase, /optionalDetailSummary/);
});

test('Phase 3 roles participate in form drafts, validation, and final project creation', () => {
    const wizard = source('src/components/projects/create-wizard/useCreateProjectWizard.ts');
    const modal = source('src/components/projects/create-wizard/CreateProjectWizard.tsx');
    const schema = source('src/lib/validations/project.ts');
    const review = source('src/components/projects/create-wizard/phases/Phase5Review.tsx');

    assert.match(wizard, /useFieldArray/);
    assert.match(wizard, /name: 'roles'/);
    assert.match(wizard, /roles: \[\]/);
    assert.match(wizard, /trigger\(\['creator_role', 'roles'\], \{ shouldFocus: true \}\)/);
    assert.match(wizard, /const resolvedRoles = \(data\.roles \|\| \[\]\)/);
    assert.match(wizard, /phase3ValidationAttempted/);
    assert.match(modal, /showValidationSummary=\{phase3ValidationAttempted\}/);
    assert.match(schema, /max\(10, 'A role can have up to 10 positions'\)/);
    assert.match(schema, /Each open role needs a unique title\./);
    assert.match(review, /openPositionCount/);
    assert.match(review, /font-mono text-\[11px\] uppercase tracking-\[0\.09em\]/);
});

test('Phase 3 rejects duplicate role titles before the project can be created', () => {
    const result = createProjectSchema.safeParse({
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
