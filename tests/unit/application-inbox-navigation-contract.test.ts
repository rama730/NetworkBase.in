import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readProjectFile(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('application notifications open the application thread, never a message', () => {
    const action = readProjectFile('src/app/actions/applications/internal.ts') + readProjectFile('src/lib/applications/notifications.ts');

    assert.doesNotMatch(action, /applicationMessageIdByApplicationId/);
    assert.doesNotMatch(action, /sourceMessageId:/);
    assert.match(action, /\? conversationHref\(params\.channelId\)/);
});
