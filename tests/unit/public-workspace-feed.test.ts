import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
    buildPublicProjectsCacheKey,
    decodePublicProjectsCursor,
    encodePublicProjectsCursor,
} from '../../src/lib/workspaces/public-feed'

describe('public projects feed cursor helpers', () => {
    it('round-trips cursor values', () => {
        const encoded = encodePublicProjectsCursor({
            createdAt: '2026-03-12T10:00:00.000Z',
            id: '11111111-2222-4333-8444-555555555555',
        })

        assert.ok(encoded)
        assert.deepEqual(
            decodePublicProjectsCursor(encoded),
            {
                createdAt: '2026-03-12T10:00:00.000Z',
                id: '11111111-2222-4333-8444-555555555555',
            },
        )
    })

    it('rejects malformed cursors', () => {
        assert.equal(decodePublicProjectsCursor('not-a-cursor'), null)
        assert.equal(decodePublicProjectsCursor(null), null)
        // Forged values never reach SQL or mint cache keys.
        const forged = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
        assert.equal(decodePublicProjectsCursor(forged({ createdAt: 'x', id: '11111111-2222-4333-8444-555555555555' })), null)
        assert.equal(decodePublicProjectsCursor(forged({ createdAt: '2026-03-12T10:00:00.000Z', id: 'project-123' })), null)
    })

    it('creates stable cache keys for equivalent pages', () => {
        const cursor = {
            createdAt: '2026-03-12T10:00:00.000Z',
            id: '11111111-2222-4333-8444-555555555555',
        }

        assert.equal(
            buildPublicProjectsCacheKey(24, cursor),
            'projects:public:v5:limit:24:cursor:2026-03-12T10:00:00.000Z:11111111-2222-4333-8444-555555555555',
        )
        assert.equal(
            buildPublicProjectsCacheKey(24, null),
            'projects:public:v5:limit:24:cursor:origin',
        )
    })
})
