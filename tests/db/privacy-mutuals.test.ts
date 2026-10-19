import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, sql } from "./_helpers";

let resolver: typeof import("../../src/lib/privacy/resolver");
before(async () => {
  resolver = await loadAppModule(() => import("../../src/lib/privacy/resolver"));
});
after(async () => { await sql.end(); await closeAppDb(); });

const accept = (a: string, b: string) =>
  sql`INSERT INTO connections (requester_id, addressee_id, status) VALUES (${a}, ${b}, 'accepted')`;

// PERF-013: mutual eligibility is computed in SQL from the viewer/target edge sets.
test("mutuals_only profiles accept requests only from viewers with a mutual connection", async () => {
  const created: string[] = [];
  const make = async (visibility = "public") => {
    const id = await sql.begin((tx) => createUser(tx, { visibility }));
    created.push(id);
    return id;
  };
  try {
    const viewer = await make();
    const withMutual = await make();
    const withoutMutual = await make();
    const peerA = await make();
    const peerB = await make();
    const stranger = await make();
    for (const id of [withMutual, withoutMutual]) {
      await sql`UPDATE profiles SET connection_privacy = 'mutuals_only' WHERE id = ${id}`;
    }
    await accept(viewer, peerA); await accept(peerB, viewer);
    await accept(withMutual, peerA); await accept(peerB, withMutual); // two mutuals, both edge directions
    await accept(withoutMutual, stranger);                            // peer the viewer does not share

    const batch = await resolver.resolvePrivacyRelationships(viewer, [withMutual, withoutMutual]);
    assert.equal(batch.get(withMutual)!.canSendConnectionRequest, true);
    assert.equal(batch.get(withoutMutual)!.canSendConnectionRequest, false);

    const single = await resolver.resolvePrivacyRelationship(viewer, withMutual);
    assert.equal(single!.canSendConnectionRequest, true);
    assert.equal((await resolver.resolvePrivacyRelationship(viewer, withoutMutual))!.canSendConnectionRequest, false);

    // A caller that just read the live row passes it in; the decision is identical and needs no second read.
    const given = await resolver.resolvePrivacyRelationship(viewer, withoutMutual, { target: { visibility: "public", messagePrivacy: "connections", connectionPrivacy: "mutuals_only" } });
    assert.equal(given!.canSendConnectionRequest, false);
    const loosened = await resolver.resolvePrivacyRelationship(viewer, withoutMutual, { target: { visibility: "public", messagePrivacy: "connections", connectionPrivacy: "everyone" } });
    assert.equal(loosened!.canSendConnectionRequest, true);
  } finally {
    await sql`DELETE FROM connections WHERE requester_id = ANY(${created}::uuid[]) OR addressee_id = ANY(${created}::uuid[])`;
    await sql`DELETE FROM auth.users WHERE id = ANY(${created}::uuid[])`;
  }
});
