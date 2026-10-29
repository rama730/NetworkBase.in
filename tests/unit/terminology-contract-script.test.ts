import assert from 'node:assert/strict';
import test from 'node:test';
import { copyStrings, ratchet, ruleHits } from '../../scripts/check-terminology-contract';

test('visible copy is found; code strings are not', () => {
  const found = copyStrings(`
    import x from "project-files";
    const a = { kind: "project" };
    if (k === "project") {}
    logger.info("project.created");
    export const C = () => <button className="project-card" title="Edit Project">Invite Collaborator</button>;
    toast.error(\`Couldn't open \${name}\`);
  `, 'f.tsx');
  assert.deepEqual(found, ['Edit Project', 'Invite Collaborator', 'Couldn\'t open {}']);
});

test('rules', () => {
  assert.deepEqual(ruleHits('Danger Zone'), ['banned', 'title-case']);
  assert.deepEqual(ruleHits('Add external project'), []);
  assert.deepEqual(ruleHits('Side project'), []);
  assert.deepEqual(ruleHits('Saved successfully!'), ['exclamation', 'successfully']);
  assert.deepEqual(ruleHits('Files & docs'), ['ampersand']);
  assert.deepEqual(ruleHits('Please log in to like'), ['please', 'log-in']);
  assert.deepEqual(ruleHits('Invitation cancelled'), ['british']);
  assert.deepEqual(ruleHits('Visual Studio Code'), []);
});

test('ratchet: counts may only go down, and new project paths fail', () => {
  const baseline = { strings: { 'a.tsx': { project: 2 } }, paths: ['src/lib/workspaces/x.ts'] };
  assert.deepEqual(ratchet({ strings: { 'a.tsx': { project: 2 } }, paths: baseline.paths }, baseline), { failures: [], lowered: false });
  assert.equal(ratchet({ strings: { 'a.tsx': { project: 3 } }, paths: baseline.paths }, baseline).failures.length, 1);
  assert.equal(ratchet({ strings: { 'b.tsx': { ampersand: 1 } }, paths: baseline.paths }, baseline).failures.length, 1);
  assert.deepEqual(ratchet({ strings: { 'a.tsx': { project: 1 } }, paths: baseline.paths }, baseline), { failures: [], lowered: true });
  assert.equal(ratchet({ strings: {}, paths: [...baseline.paths, 'src/new-project.ts'] }, baseline).failures.length, 1);
});
