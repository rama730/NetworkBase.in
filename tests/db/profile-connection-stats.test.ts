import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { closeAppDb, createUser, inRollback, loadAppModule, sql } from './_helpers'

let readStats: typeof import('../../src/lib/connections/stats')['getConnectionStatsForUser']
before(async () => { ({ getConnectionStatsForUser: readStats } = await loadAppModule(() => import('../../src/lib/connections/stats'))) })
after(async () => { await sql.end(); await closeAppDb() })

test('connection totals follow live accepted records in either direction, not stored counters', async () => {
  const owner = await sql.begin(tx => createUser(tx))
  const peers = []
  try {
    for (let i=0; i<3; i++) peers.push(await sql.begin(tx => createUser(tx)))
    await sql`INSERT INTO connections (requester_id, addressee_id, status) VALUES (${owner}, ${peers[0]!}, 'accepted'), (${peers[1]!}, ${owner}, 'accepted'), (${peers[2]!}, ${owner}, 'pending')`
    assert.deepEqual(await readStats(owner), { totalConnections: 2, pendingIncoming: 1, pendingSent: 0 })
    await sql`UPDATE profiles SET connections_count=99 WHERE id=${owner}`
    assert.equal((await readStats(owner)).totalConnections, 2)
    await sql`UPDATE connections SET status='accepted' WHERE requester_id=${peers[2]!} AND addressee_id=${owner}`
    assert.equal((await readStats(owner)).totalConnections, 3)
    await sql`SELECT app_private.block_user(${owner}::uuid, ${peers[0]!}::uuid, 'profile', NULL)`;
    assert.equal((await readStats(owner)).totalConnections, 2)
    await sql`UPDATE profiles SET deleted_at=now() WHERE id=${peers[1]!}`
    assert.equal((await readStats(owner)).totalConnections, 1)
    await sql`DELETE FROM connections WHERE requester_id=${peers[2]!} AND addressee_id=${owner}`
    assert.equal((await readStats(owner)).totalConnections, 0)
  } finally {
    await sql`DELETE FROM connections WHERE requester_id=${owner} OR addressee_id=${owner}`
    await sql`DELETE FROM auth.users WHERE id=ANY(${[owner,...peers]}::uuid[])`
  }
})
