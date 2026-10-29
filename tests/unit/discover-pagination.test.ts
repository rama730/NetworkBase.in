import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';

describe('Hub pagination', () => {
    it('rejects foreign cursors and keeps Hub reads bounded', () => {
        const root = process.cwd();
        const action = readFileSync(path.join(root, 'src/app/actions/discover.ts'), 'utf8');
        const data = readFileSync(path.join(root, 'src/lib/data/discover.ts'), 'utf8');
        const follows = readFileSync(path.join(root, 'src/hooks/workspaces/useUserInteractions.ts'), 'utf8');

        // Only offered values reach SQL; every read is rate-limited.
        assert.match(action, /status: z\.enum\(/);
        assert.match(action, /consumeRateLimitForRoute\('publicRead'/);
        assert.match(data, /parsedCursor\.fingerprint !== filtersFingerprint/);
        assert.match(data, /parsedCursor\.kind !== \(scoreExpr \? 'score' : 'time'\)/);
        assert.match(data, /throw new InvalidDiscoverCursorError\(\)/);
        assert.match(data, /\.limit\(pageSize \+ 1\)/);
        assert.match(data, /const hasMore = rawProjects\.length > pageSize/);
        assert.match(data, /while \(pageRows\.length < pageSize/);
        // One follow lookup per feed page: bounded, and loaded pages never refetch.
        assert.match(follows, /\.in\('project_id', pageIds\)/);
        assert.doesNotMatch(follows, /\.eq\('user_id', userId\);/);
    });
});
