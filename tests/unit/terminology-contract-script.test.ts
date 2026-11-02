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
  // "Lead" as an access level hides in sentences; job titles and team leads stay.
  for (const text of ['Message lead', 'Remind leads', 'needs a new lead', 'You’re the lead of it', 'to their leads', 'Lead: Asha', 'Leaders can always do both', 'This person leads a workspace']) {
    assert.deepEqual(ruleHits(text), ['banned'], text);
  }
  for (const text of ['Team lead', 'Make team lead', 'Lead designer', 'Repeated breaks lead to limits', 'lead generation']) {
    assert.deepEqual(ruleHits(text), [], text);
  }
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

test("39.4: the organization glossary's never-say words are counted on screen", () => {
  for (const text of ["Returned for changes", "Invite a Guest", "Needs you", "Org overview", "master assignment"]) assert.ok(ruleHits(text).includes("org-word"), text);
  for (const text of ["Organization overview", "Returned", "Viewer", "Needs your attention"]) assert.ok(!ruleHits(text).includes("org-word"), text);
});
