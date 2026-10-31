import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import {
    buildPublicWorkspacesCacheKey,
    decodePublicWorkspacesCursor,
    encodePublicWorkspacesCursor,
} from '../../src/lib/workspaces/public-feed'

describe('public projects feed cursor helpers', () => {
    it('round-trips cursor values', () => {
        const encoded = encodePublicWorkspacesCursor({
            createdAt: '2026-03-12T10:00:00.000Z',
            id: '11111111-2222-4333-8444-555555555555',
        })

        assert.ok(encoded)
        assert.deepEqual(
            decodePublicWorkspacesCursor(encoded),
            {
                createdAt: '2026-03-12T10:00:00.000Z',
                id: '11111111-2222-4333-8444-555555555555',
            },
        )
    })

    it('rejects malformed cursors', () => {
        assert.equal(decodePublicWorkspacesCursor('not-a-cursor'), null)
        assert.equal(decodePublicWorkspacesCursor(null), null)
        // Forged values never reach SQL or mint cache keys.
        const forged = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
        assert.equal(decodePublicWorkspacesCursor(forged({ createdAt: 'x', id: '11111111-2222-4333-8444-555555555555' })), null)
        assert.equal(decodePublicWorkspacesCursor(forged({ createdAt: '2026-03-12T10:00:00.000Z', id: 'project-123' })), null)
    })

    it('creates stable cache keys for equivalent pages', () => {
        const cursor = {
            createdAt: '2026-03-12T10:00:00.000Z',
            id: '11111111-2222-4333-8444-555555555555',
        }

        assert.equal(
            buildPublicWorkspacesCacheKey(24, cursor),
            'projects:public:v5:limit:24:cursor:2026-03-12T10:00:00.000Z:11111111-2222-4333-8444-555555555555',
        )
        assert.equal(
            buildPublicWorkspacesCacheKey(24, null),
            'projects:public:v5:limit:24:cursor:origin',
        )
    })
})

describe('what leaves Discover', () => {
    const source = (path: string) => readFileSync(path, 'utf8')

    it('hides the same workspaces from the default feed and the filtered feed', () => {
        // A workspace hidden, suspended or being deleted by moderation must not stay on the default Discover page.
        for (const file of ['src/lib/workspaces/public-feed-service.ts', 'src/lib/data/discover.ts']) {
            assert.match(source(file), /discoverListedSql\(\)/, file)
        }
        const rule = source('src/lib/discover/listed-sql.ts')
        for (const column of ['discoverHiddenAt', 'suspendedAt', 'deletionScheduledAt']) assert.match(rule, new RegExp(column))
    })
})
