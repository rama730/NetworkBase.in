import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('the persistent header opens Create Project in place instead of navigating to Discover', () => {
    const header = source('src/components/layout/header/TopNav.tsx');

    assert.match(header, /const CreateProjectWizard = dynamic/);
    assert.match(header, /const \[showCreateProject, setShowCreateProject\] = useState\(false\)/);
    assert.match(header, /setShowCreateProject\(true\)/);
    assert.match(header, /\{showCreateProject && \(/);
    assert.match(header, /onClose=\{\(\) => \{/);
    assert.match(header, /setShowCreateProject\(false\)/);
    assert.match(header, /router\.push\(`\/projects\/\$\{projectId\}`\)/);
    assert.doesNotMatch(header, /href=\{`\$\{ROUTES\.HUB\}\?createProject=1`\}/);
});
