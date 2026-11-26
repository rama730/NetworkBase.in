import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { addMember, createProject, createUser, inRollback, sql, type Tx } from "./_helpers";

after(() => sql.end());

// Global search mix "Never shown" + "Who can find me" (report §6 decisions 3 and 4; plan R1).
const finds = async (tx: Tx, viewer: string, person: string) => {
  const [row] = await tx`SELECT app_private.search_findable(${viewer}::uuid, ${person}::uuid) AS ok`;
  return row!.ok as boolean;
};
const setFind = (tx: Tx, id: string, value: string) => tx`UPDATE public.profiles SET search_visibility = ${value} WHERE id = ${id}`;

async function school(tx: Tx, owner: string, kind: "school" | "coaching" | "college") {
  const id = randomUUID();
  await tx`INSERT INTO public.workspaces (id, owner_id, title, slug, kind, org_type, org_level, org_settings, visibility)
           VALUES (${id}, ${owner}, 'Green Valley', ${`s-${id}`}, 'organization', 'education', 'institution', ${tx.json({ schoolKind: kind })}, 'public')`;
  return id;
}
async function classIn(tx: Tx, owner: string, institutionId: string) {
  const id = randomUUID();
  await tx`INSERT INTO public.workspaces (id, owner_id, title, slug, kind, org_type, institution_id, visibility)
           VALUES (${id}, ${owner}, 'Class 8B', ${`c-${id}`}, 'organization', 'education', ${institutionId}, 'private')`;
  return id;
}

test("everyone: a stranger finds them; private profiles and yourself never", async () => {
  await inRollback(async (tx) => {
    const [viewer, person] = [await createUser(tx), await createUser(tx)];
    assert.equal(await finds(tx, viewer, person), true);
    assert.equal(await finds(tx, viewer, viewer), false);
    await tx`UPDATE public.profiles SET visibility = 'private' WHERE id = ${person}`;
    assert.equal(await finds(tx, viewer, person), false);
  });
});

test("only my connections: a stranger can't find them, a connection can", async () => {
  await inRollback(async (tx) => {
    const [viewer, person, friend] = [await createUser(tx), await createUser(tx), await createUser(tx)];
    await setFind(tx, person, "connections");
    assert.equal(await finds(tx, viewer, person), false);
    await tx`INSERT INTO public.connections (requester_id, addressee_id, status) VALUES (${friend}, ${person}, 'accepted')`;
    assert.equal(await finds(tx, friend, person), true);
  });
});

test("people in my workspaces and orgs: shared workspace finds them, a stranger doesn't", async () => {
  await inRollback(async (tx) => {
    const [viewer, person, stranger] = [await createUser(tx), await createUser(tx), await createUser(tx)];
    await setFind(tx, person, "my_places");
    const ws = await createProject(tx, person);
    await addMember(tx, ws, viewer);
    assert.equal(await finds(tx, viewer, person), true);
    assert.equal(await finds(tx, stranger, person), false);
  });
});

test("a learner in a school's class is hidden outside the school, found inside it", async () => {
  await inRollback(async (tx) => {
    const [teacher, learner, outsider, otherTeacher] = [await createUser(tx), await createUser(tx), await createUser(tx), await createUser(tx)];
    const s = await school(tx, teacher, "school");
    const c = await classIn(tx, teacher, s);
    await addMember(tx, c, learner);
    assert.equal(await finds(tx, outsider, learner), false);
    // Someone in another class of the same school shares the place.
    const c2 = await classIn(tx, otherTeacher, s);
    await addMember(tx, c2, outsider, "admin");
    assert.equal(await finds(tx, outsider, learner), true);
    // A teacher (owner) of a class is not a learner.
    assert.equal(await finds(tx, learner, teacher), true);
  });
});

test("college learners are not under the minors rule", async () => {
  await inRollback(async (tx) => {
    const [teacher, learner, outsider] = [await createUser(tx), await createUser(tx), await createUser(tx)];
    const c = await classIn(tx, teacher, await school(tx, teacher, "college"));
    await addMember(tx, c, learner);
    assert.equal(await finds(tx, outsider, learner), true);
  });
});

test("a block either way hides them", async () => {
  await inRollback(async (tx) => {
    const [viewer, person] = [await createUser(tx), await createUser(tx)];
    await tx`INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (${person}, ${viewer})`;
    assert.equal(await finds(tx, viewer, person), false);
    assert.equal(await finds(tx, person, viewer), false);
  });
});
