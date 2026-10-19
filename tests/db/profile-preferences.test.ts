import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: viewerId } }, error: null }) } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });

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
