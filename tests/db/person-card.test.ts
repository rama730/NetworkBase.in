import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createUser, createProject, sql, loadAppModule, closeAppDb, moduleStubs } from './_helpers';

moduleStubs.set('@/lib/redis', { redis: null, getRedisClient: () => null, getCachedData: async () => null, cacheData: async () => undefined });
let read: typeof import('../../src/lib/network/person-card-read')['readPersonCardDetails'];
const users: string[] = [], projects: string[] = [];
before(async () => { ({ readPersonCardDetails: read } = await loadAppModule(() => import('../../src/lib/network/person-card-read'))); });
after(async () => {
    if (projects.length) await sql`DELETE FROM projects WHERE id=ANY(${projects}::uuid[])`;
    if (users.length) await sql`DELETE FROM connections WHERE requester_id=ANY(${users}::uuid[]) OR addressee_id=ANY(${users}::uuid[])`;
    if (users.length) await sql`DELETE FROM auth.users WHERE id=ANY(${users}::uuid[])`;
    await sql.end(); await closeAppDb();
});
async function user(visibility = 'public') {
    const id = await sql.begin(tx => createUser(tx, { visibility })); users.push(id);
    await sql`UPDATE profiles SET onboarding_status='completed' WHERE id=${id}`;
    return id;
}

test('person-card metadata batches actual visible mutuals, canonical public skills and published portfolio evidence', async () => {
    const viewer = await user(), person = await user(), peer = await user(), hidden = await user('private'), stranger = await user();
    await sql`UPDATE profiles SET open_to_collaborate=true, skills='["Legacy private skill"]'::jsonb WHERE id=${person}`;
    for (const common of [peer, hidden]) {
        await sql`INSERT INTO connections(requester_id,addressee_id,status) VALUES (${viewer},${common},'accepted'),(${person},${common},'accepted')`;
    }
    const visible = await sql.begin(tx => createProject(tx, person)); projects.push(visible);
    const privateProject = await sql.begin(tx => createProject(tx, person, { visibility: 'private' })); projects.push(privateProject);
    for (const id of [visible, privateProject]) await sql`INSERT INTO profile_project_contributions(profile_id,project_id,source,role_kind,visibility) VALUES(${person},${id},'manual','contributor','public') ON CONFLICT DO NOTHING`;
    const [skill] = await sql`SELECT id,name FROM skills WHERE status='active' ORDER BY name LIMIT 1`;
    assert.ok(skill);
    await sql`INSERT INTO profile_skills(profile_id,skill_id,visibility) VALUES(${person},${skill.id},'public')`;
    let result = await read(viewer, [person, stranger]);
    assert.equal(result[person]?.openToCollaborate, true);
    assert.equal(result[person]?.mutualConnections, 1);
    assert.equal(result[person]?.portfolio?.total, 1);
    assert.equal(result[person]?.portfolio?.projects[0]?.id, visible);
    assert.deepEqual(result[person]?.skills, [skill.name]);
    await sql`INSERT INTO profile_project_contributions(profile_id,external_key,project_title,source,role_kind,visibility) VALUES(${person},'public-external','Public external work','manual','contributor','public')`;
    result = await read(viewer, [person]);
    assert.equal(result[person]?.portfolio?.total, 2);
    assert.ok(result[person]?.portfolio?.projects.some(project => project.title === 'Public external work'));
    await sql`UPDATE profile_project_contributions SET visibility='private' WHERE profile_id=${person} AND project_id IS NULL`;

    await sql`UPDATE projects SET status='completed' WHERE id=${visible}`;
    result = await read(viewer, [person]);
    assert.equal(result[person]?.portfolio?.total, 1);
    await sql`UPDATE profiles SET visibility='private' WHERE id=${person}`;
    result = await read(viewer, [person]);
    assert.equal(result[person]?.isLockedProfile, true);
    assert.equal(result[person]?.openToCollaborate, undefined);
    assert.equal(result[person]?.portfolio, undefined);
    assert.equal(result[person]?.mutualConnections, undefined);
    await sql`UPDATE profiles SET visibility='public' WHERE id=${person}`;
    await sql`INSERT INTO connections(requester_id,addressee_id,status,blocked_by,blocked_at) VALUES(${viewer},${person},'blocked',${viewer},now())`;
    result = await read(viewer, [person]);
    assert.equal(result[person]?.isUnavailable, true);
    assert.equal(result[person]?.portfolio, undefined);

});

test('acceptance time is captured once per accepted relationship and never invented for old accepted rows', async () => {
    const viewer = await user(), person = await user();
    const [pending] = await sql`INSERT INTO connections(requester_id,addressee_id,status) VALUES(${viewer},${person},'pending') RETURNING id,accepted_at`;
    assert.equal(pending!.accepted_at, null);
    const [accepted] = await sql`UPDATE connections SET status='accepted' WHERE id=${pending!.id} RETURNING accepted_at`;
    assert.ok(accepted!.accepted_at instanceof Date);
    const [changed] = await sql`UPDATE connections SET updated_at=now()+interval '3 days',accepted_at=now()+interval '4 days' WHERE id=${pending!.id} RETURNING accepted_at`;
    assert.equal(changed!.accepted_at.toISOString(), accepted!.accepted_at.toISOString());
    const [disconnected] = await sql`UPDATE connections SET status='disconnected' WHERE id=${pending!.id} RETURNING accepted_at`;
    assert.equal(disconnected!.accepted_at, null);
});
