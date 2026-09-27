import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { getCreateProjectReturnPath, parseCreateProjectSource } from '../../src/components/projects/create-wizard/github-oauth-resume';

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('the GitHub OAuth return path preserves the current route and strips only wizard handoff parameters', () => {
    const returnPath = getCreateProjectReturnPath({
        pathname: '/projects/deepscope-ai',
        search: '?tab=settings&createProject=1&createProjectSource=github',
        hash: '#links',
    } as Location);

    assert.equal(returnPath, '/projects/deepscope-ai?tab=settings#links');
    assert.equal(parseCreateProjectSource('github'), 'github');
    assert.equal(parseCreateProjectSource('invalid'), null);
});

test('GitHub authorization snapshots wizard input, restores the in-place modal, and resumes repository checks', () => {
    const phase = source('src/components/projects/create-wizard/phases/Phase1SourceSelection.tsx');
    const wizard = source('src/components/projects/create-wizard/CreateProjectWizard.tsx');
    const topNav = source('src/components/layout/header/TopNav.tsx');
    const hub = source('src/components/discover/DiscoverClient.tsx');

    assert.match(phase, /saveGithubOAuthResume\(getValues\(\), getCreateProjectReturnPath\(returnUrl\)\)/);
    assert.match(phase, /isResumingGithubOAuth/);
    assert.match(phase, /void loadGithubPreview\(repoUrl, branch \|\| null\)/);
    assert.match(wizard, /initialValues: githubOAuthResume\?\.values/);
    assert.match(wizard, /onGithubOAuthResumeRestored/);
    assert.match(topNav, /readGithubOAuthResume\(returnPath\)/);
    assert.match(topNav, /pathname === '\/discover'/);
    assert.match(hub, /readGithubOAuthResume\(returnPath\)/);
});
