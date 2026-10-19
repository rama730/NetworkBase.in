import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
    await sql`UPDATE connections SET status='blocked', blocked_by=${owner}, blocked_at=now() WHERE requester_id=${owner} AND addressee_id=${peers[0]!}`
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

test('migration preserves legacy display, repairs counters, and never re-enables an explicit pause', async () => {
  await inRollback(async tx => {
    await tx`ALTER TABLE profiles DROP COLUMN open_to_collaborate`
    const legacy = await createUser(tx)
    const capacity = await createUser(tx)
    const empty = await createUser(tx)
    await tx`UPDATE profiles SET open_to='["Contract roles"]'::jsonb WHERE id=${legacy}`
    await tx`UPDATE profiles SET hours_per_week='h_10_20' WHERE id=${capacity}`
    await tx`INSERT INTO connections (requester_id, addressee_id, status) VALUES (${legacy}, ${empty}, 'accepted')`
    const migration = readFileSync('drizzle/0218_profile_collaboration_availability.sql', 'utf8')
    await tx.unsafe(migration)
    const rows = await tx`SELECT id,open_to_collaborate,connections_count FROM profiles WHERE id IN (${legacy},${capacity},${empty})`
    assert.equal(rows.find(r=>r.id===legacy)?.open_to_collaborate, true)
    assert.equal(rows.find(r=>r.id===capacity)?.open_to_collaborate, true)
    assert.equal(rows.find(r=>r.id===empty)?.open_to_collaborate, false)
    assert.equal(rows.find(r=>r.id===legacy)?.connections_count, 1)
    await tx`UPDATE profiles SET open_to_collaborate=false WHERE id=${legacy}`
    await tx.unsafe(migration)
    const [paused] = await tx`SELECT open_to_collaborate FROM profiles WHERE id=${legacy}`
    assert.equal(paused?.open_to_collaborate, false)
    const newcomer = await createUser(tx)
    const [fresh] = await tx`SELECT open_to_collaborate FROM profiles WHERE id=${newcomer}`
    assert.equal(fresh?.open_to_collaborate, false)
  })
})
