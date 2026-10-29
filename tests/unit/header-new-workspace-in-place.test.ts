import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('every New workspace entry opens the full-page create route instead of a modal', () => {
    const header = source('src/components/layout/header/TopNav.tsx');
    const mobileMenu = source('src/components/layout/header/MobileMenu.tsx');
    const discover = source('src/components/discover/DiscoverClient.tsx');

    for (const entry of [header, mobileMenu, discover]) {
        assert.match(entry, /<Link\s+href="\/workspaces\/new"/);
        assert.doesNotMatch(entry, /CreateWorkspaceWizard|showCreateProject|showCreateModal|onNewProject/);
    }
    assert.doesNotMatch(discover, /discover:create-project-modal-state/);
});
