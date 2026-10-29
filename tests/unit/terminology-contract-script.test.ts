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

test('a note from the report is never copy: "(keep)" is caught as it was shown to people', () => {
  // The report marks rows that stay as they are with "*(keep)*"; once it was applied as wording and shipped in a toast.
  assert.deepEqual(ruleHits('connection request *(keep)*'), ['annotation']);
  assert.deepEqual(ruleHits('enforces mutual-only connection request (keep) rules'), ['annotation']);
  assert.deepEqual(copyStrings('toast.success(`Accepted ${n} connection request *(keep)*s`)', 'f.tsx').flatMap(ruleHits), ['annotation']);
  assert.deepEqual(ruleHits('Connection request'), []);
  assert.deepEqual(ruleHits('Keep this open'), []);
});

test('ratchet: counts may only go down, and new project paths fail', () => {
  const baseline = { strings: { 'a.tsx': { project: 2 } }, paths: ['src/lib/workspaces/x.ts'] };
  assert.deepEqual(ratchet({ strings: { 'a.tsx': { project: 2 } }, paths: baseline.paths }, baseline), { failures: [], lowered: false });
  assert.equal(ratchet({ strings: { 'a.tsx': { project: 3 } }, paths: baseline.paths }, baseline).failures.length, 1);
  assert.equal(ratchet({ strings: { 'b.tsx': { ampersand: 1 } }, paths: baseline.paths }, baseline).failures.length, 1);
  assert.deepEqual(ratchet({ strings: { 'a.tsx': { project: 1 } }, paths: baseline.paths }, baseline), { failures: [], lowered: true });
  assert.equal(ratchet({ strings: {}, paths: [...baseline.paths, 'src/new-project.ts'] }, baseline).failures.length, 1);
});
