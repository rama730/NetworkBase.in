import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// `after()` only runs inside a request; the test has none, so run the callback right away.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const realNextServer = require("next/server") as Record<string, unknown>;
moduleStubs.set("next/server", { ...realNextServer, after: (task: unknown) => { void Promise.resolve(typeof task === "function" ? (task as () => unknown)() : task).catch(() => undefined); } });
moduleStubs.set("@/lib/redis", { redis: null, getRedisClient: () => null, getCachedData: async () => null, cacheData: async () => undefined });

moduleStubs.set("@/lib/security/rate-limit", { consumeRateLimit: async () => ({ allowed: true, count: 1, limit: 60, remaining: 59, resetAt: Date.now() + 60000, degraded: false }) });

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: viewerId ? { id: viewerId } : null }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }) } });

let actions: typeof import("../../src/app/actions/profile");
let data: typeof import("../../src/lib/data/profile");
before(async () => {
  actions = await loadAppModule(() => import("../../src/app/actions/profile"));
  data = await loadAppModule(() => import("../../src/lib/data/profile"));
});
after(async () => { await sql.end(); await closeAppDb(); });

// API-014: role/category preferences are persisted and read back for everyone allowed to see the profile.
test("custom roles and preferred categories survive save and read", async () => {
  const owner = await sql.begin((tx) => createUser(tx));
  const stranger = await sql.begin((tx) => createUser(tx));
  try {
    viewerId = owner;
    const saved = await actions.updateProfileAction({ openToCustomRoles: ["Game Designer", " game designer ", "Sound Artist"], preferredCategories: ["games", "open-source"] });
    assert.equal(saved.success, true, "error" in saved ? String(saved.error) : "");
    const [row] = await sql`SELECT open_to_custom_roles, preferred_categories FROM profiles WHERE id = ${owner}`;
    assert.deepEqual(row!.open_to_custom_roles, ["Game Designer", "Sound Artist"]);
    assert.deepEqual(row!.preferred_categories, ["games", "open-source"]);

    const details = await data.getProfileDetails(undefined, { viewerUser: { id: owner } as never, recordViewEvent: false, skipHeavyData: true });
    assert.deepEqual(details.profile?.openToCustomRoles, ["Game Designer", "Sound Artist"]);
    assert.deepEqual(details.profile?.preferredCategories, ["games", "open-source"]);

    const asStranger = await data.getProfileDetails(owner, { viewerUser: { id: stranger } as never, recordViewEvent: false, skipHeavyData: true });
    assert.deepEqual(asStranger.profile?.preferredCategories, ["games", "open-source"]);

    // Clearing works: an empty list is a real value, not "unchanged".
    const cleared = await actions.updateProfileAction({ preferredCategories: [] });
    assert.equal(cleared.success, true);
    const [after2] = await sql`SELECT preferred_categories FROM profiles WHERE id = ${owner}`;
    assert.deepEqual(after2!.preferred_categories, []);
  } finally {
    await sql`DELETE FROM profile_audit_events WHERE user_id = ${owner}`;
  }
});


test("availability and role preferences save together; pausing preserves preferences and conflicts preserve the winner", async () => {
  const owner = await sql.begin(tx => createUser(tx));
  const stranger = await sql.begin(tx => createUser(tx));
  try {
    viewerId = owner;
    const saved = await actions.updateProfileAction({ openToCollaborate: true, openTo: ["Contract roles"], openToCustomRoles: ["Rust Developer"], preferredCategories: ["Engineering"], hoursPerWeek: "h_10_20" });
    assert.equal(saved.success, true);
    if (!saved.success) throw new Error(saved.error);
    const paused = await actions.updateProfileAction({ openToCollaborate: false, expectedUpdatedAt: saved.updatedAt });
    assert.equal(paused.success, true);
    const details = await data.getProfileDetails(owner, { viewerUser: { id: owner } as never, recordViewEvent: false, skipHeavyData: true });
    assert.equal(details.profile?.openToCollaborate, false);
    assert.deepEqual(details.profile?.openToCustomRoles, ["Rust Developer"]);
    assert.deepEqual(details.profile?.preferredCategories, ["Engineering"]);
    assert.deepEqual(details.profile?.openTo, ["Contract roles"]);
    assert.equal(details.profile?.hoursPerWeek, "h_10_20");
    const conflict = await actions.updateProfileAction({ openToCollaborate: true, expectedUpdatedAt: saved.updatedAt });
    assert.equal(conflict.success, false);
    assert.equal("errorCode" in conflict && conflict.errorCode, "PROFILE_CONFLICT");
    const [winner] = await sql`SELECT open_to_collaborate FROM profiles WHERE id=${owner}`;
    assert.equal(winner!.open_to_collaborate, false);
    const resumed = await actions.updateProfileAction({ openToCollaborate: true });
    assert.equal(resumed.success, true);
    await sql`UPDATE profiles SET visibility='private' WHERE id=${owner}`;
    const locked = await data.getProfileDetails(owner, { viewerUser: { id: stranger } as never, recordViewEvent: false, skipHeavyData: true });
    assert.equal(locked.profile?.openToCollaborate, false);
    assert.deepEqual(locked.profile?.openToCustomRoles, []);
    viewerId = "";
    const anonymous = await actions.updateProfileAction({ openToCollaborate: true });
    assert.equal(anonymous.success, false);
  } finally {
    await sql`DELETE FROM auth.users WHERE id IN (${owner},${stranger})`;
  }
});
