import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function extractExportedFunction(source: string, functionName: string) {
    let start = source.indexOf(`export async function ${functionName}`);
    if (start === -1) {
        start = source.indexOf(`export function ${functionName}`);
    }
    assert.notEqual(start, -1, `${functionName} should exist`);
    const nextFunction = source.indexOf('\nexport ', start + functionName.length);
    return source.slice(start, nextFunction === -1 ? undefined : nextFunction);
}

test('applications barrel delegates the server boundary to its async implementation module', () => {
    const barrel = readProjectFile('src/app/actions/applications/index.ts');
    const internal = readProjectFile('src/app/actions/applications/internal.ts');

    assert.doesNotMatch(barrel, /^['"]use server['"];?/m);
    assert.match(internal, /^['"]use server['"];?/m);
    assert.doesNotMatch(internal, /^export (?!async function|type |interface )/m);
});

test('acceptProposedRoleAction uses pessimistic lock preventing double-booking', () => {
    const source = readProjectFile('src/app/actions/applications/internal.ts');
    const acceptProposed = extractExportedFunction(source, 'acceptProposedRoleAction');

    // Asserts that db transaction with FOR UPDATE locking is used
    assert.match(acceptProposed, /db\.transaction\(async \(tx\) => \{/);
    assert.match(acceptProposed, /\.for\('update'\)/);
    assert.match(acceptProposed, /tx\s*\.\s*update\(roleApplications\)/);
    assert.match(acceptProposed, /status:\s*'accepted'/);
});

test('declineProposedRoleAction reverts application back to pending', () => {
    const source = readProjectFile('src/app/actions/applications/internal.ts');
    const declineProposed = extractExportedFunction(source, 'declineProposedRoleAction');

    assert.match(declineProposed, /tx\s*\.\s*update\(roleApplications\)/);
    assert.match(declineProposed, /status:\s*'pending'/);
    assert.match(declineProposed, /proposedRoleId:\s*null/);
    assert.match(declineProposed, /decisionBy:\s*null/);
    assert.match(declineProposed, /decisionAt:\s*null/);
});

{
  const internal = readProjectFile("src/app/actions/applications/internal.ts");

  test("invitation lists read the canonical project_invitations table", () => {
    assert.match(internal, /async function listInvitationsInternal/);
    assert.match(internal, /listInvitationsInternal\(\{ userId: user\.id, pendingOnly: true/);
    assert.match(internal, /\.from\(projectInvitations\)/);
    assert.doesNotMatch(internal, /messageWorkflowItems|conversationParticipants|dmPairs/);
  });

  test("every new application opens its own chat thread in the same transaction", () => {
    assert.match(internal, /ensureApplicationChannel\(tx, newApp!\.id\)/);
  });

  test("invite options list pending invitations from project_invitations", () => {
    assert.match(internal, /assigneeUserId: projectInvitations\.candidateId/);
  });
}
