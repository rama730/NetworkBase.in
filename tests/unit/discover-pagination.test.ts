import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';

describe('Hub pagination', () => {
    it('rejects foreign cursors and keeps Hub reads bounded', () => {
        const root = process.cwd();
        const action = readFileSync(path.join(root, 'src/app/actions/discover.ts'), 'utf8');
        const data = readFileSync(path.join(root, 'src/lib/data/discover.ts'), 'utf8');
        const follows = readFileSync(path.join(root, 'src/hooks/projects/useUserInteractions.ts'), 'utf8');

        assert.match(action, /includedIds: filters\.includedIds\?\.length/);
        assert.match(data, /parsedCursor\.fingerprint !== filtersFingerprint/);
        assert.match(data, /parsedCursor\.kind !== \(scoreExpr \? 'score' : 'time'\)/);
        assert.match(data, /throw new InvalidDiscoverCursorError\(\)/);
        assert.match(data, /\.limit\(pageSize \+ 1\)/);
        assert.match(data, /const hasMore = rawProjects\.length > pageSize/);
        assert.match(data, /while \(pageRows\.length < pageSize/);
        assert.match(follows, /\.in\('project_id', visibleProjectIds\)/);
        assert.doesNotMatch(follows, /\.eq\('user_id', userId\);/);
    });
});
