import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { getCreateWorkspaceReturnPath, parseCreateWorkspaceSource } from '../../src/components/workspaces/create-wizard/github-oauth-resume';

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('the GitHub OAuth return path preserves the current route and strips only wizard handoff parameters', () => {
    const returnPath = getCreateWorkspaceReturnPath({
        pathname: '/workspaces/deepscope-ai',
        search: '?tab=settings&createProject=1&createProjectSource=github',
        hash: '#links',
    } as Location);

    assert.equal(returnPath, '/workspaces/deepscope-ai?tab=settings#links');
    assert.equal(parseCreateWorkspaceSource('github'), 'github');
    assert.equal(parseCreateWorkspaceSource('invalid'), null);
});

test('GitHub authorization snapshots wizard input, restores it on the create route, and resumes repository checks', () => {
    const phase = source('src/components/workspaces/create-wizard/phases/Phase1SourceSelection.tsx');
    const wizard = source('src/components/workspaces/create-wizard/CreateWorkspaceWizard.tsx');
    const route = source('src/components/workspaces/create-wizard/CreateWorkspaceRouteClient.tsx');
    const topNav = source('src/components/layout/header/TopNav.tsx');
    const hub = source('src/components/discover/DiscoverClient.tsx');

    assert.match(phase, /saveGithubOAuthResume\(getValues\(\), getCreateWorkspaceReturnPath\(returnUrl\)\)/);
    assert.match(phase, /isResumingGithubOAuth/);
    assert.match(phase, /void loadGithubPreview\(repoUrl, branch \|\| null\)/);
    assert.match(wizard, /initialValues: githubOAuthResume\?\.values/);
    assert.match(wizard, /onGithubOAuthResumeRestored/);
    // The create route is the wizard's only home, so it alone restores the hand-off.
    assert.match(route, /readGithubOAuthResume\(returnPath\)/);
    assert.match(route, /githubOAuthResume=\{handoff\.resume\}/);
    assert.match(route, /router\.replace\(readCreateWorkspaceReturnPath\(\) \?\? '\/discover'\)/);
    assert.doesNotMatch(topNav, /readGithubOAuthResume/);
    assert.doesNotMatch(hub, /readGithubOAuthResume/);
});
