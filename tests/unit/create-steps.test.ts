import assert from 'node:assert/strict';
import test from 'node:test';
import { createSteps } from '../../src/components/workspaces/create-wizard/create-steps';
import type { CreateWorkspaceInput } from '../../src/lib/validations/workspace';

// Create workspace v6 (Task 7): "When you press Create" — one row per real step, the import last.
const base = { title: 'Garden Map', readme: { mode: 'starter', publishOnCreate: false }, roles: [], workflows: [] } as unknown as CreateWorkspaceInput;
const ctx = { uploadCount: 0, peopleCount: 0 };

test('github → the last step is import, and it keeps going if you leave', () => {
    const steps = createSteps({ ...base, import_source: { type: 'github', repoUrl: 'https://github.com/ada/seed-swap', branch: 'main' } } as CreateWorkspaceInput, ctx);
    assert.equal(steps[0]!.key, 'make');
    assert.equal(steps[0]!.label, 'Making Garden Map');
    const last = steps.at(-1)!;
    assert.equal(last.key, 'import');
    assert.equal(last.label, 'Importing ada/seed-swap');
    assert.equal(last.background, true);
});

test('upload → the last step is upload, with its file count, and the tab must stay open', () => {
    const steps = createSteps({ ...base, import_source: { type: 'upload', metadata: { folderName: 'garden-map', fileCount: 45 } } } as unknown as CreateWorkspaceInput, { ...ctx, uploadCount: 45 });
    const last = steps.at(-1)!;
    assert.equal(last.key, 'upload');
    assert.equal(last.label, 'Uploading garden-map/');
    assert.equal(last.count, 45);
    assert.equal(last.unit, 'files');
    assert.equal(last.keepTabOpen, true);
});

test('Posting 1 opening on Discover when one role has count 1; untitled roles do not count', () => {
    const steps = createSteps({ ...base, roles: [{ role: 'Frontend developer', count: 1 }, { role: ' ', count: 3 }] } as unknown as CreateWorkspaceInput, ctx);
    assert.ok(steps.some((s) => s.key === 'openings' && s.label === 'Posting 1 opening on Discover'));
});

test('the doc, each workflow tab and the people placed in teams each get a row; a skipped doc does not', () => {
    const steps = createSteps({ ...base, readme: { mode: 'starter', publishOnCreate: true }, workflows: ['roadmap'] } as unknown as CreateWorkspaceInput, { ...ctx, peopleCount: 2 });
    assert.deepEqual(steps.map((s) => s.key), ['make', 'doc', 'workflow:roadmap', 'people']);
    assert.equal(steps[1]!.label, 'Drafting the starter doc and publishing it');
    assert.match(steps[2]!.label, /^Adding the .+ tab$/);
    assert.equal(steps[3]!.label, 'Adding 2 people to the teams');
    assert.ok(!createSteps({ ...base, readme: { mode: 'skip' } } as unknown as CreateWorkspaceInput, ctx).some((s) => s.key === 'doc'));
});
