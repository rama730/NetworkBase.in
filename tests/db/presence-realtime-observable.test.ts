import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Badges join `presence:user:<id>` only when getPresence says Realtime allows it. The flag must come from the
// Realtime policy's own function: a refused private join takes seconds and blocks every join queued behind it.
let viewerId = "";
moduleStubs.set("@/lib/supabase/auth-user", { getAuthUser: async () => ({ id: viewerId }) });
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let presence: typeof import("../../src/app/actions/presence");
before(async () => {
  presence = await loadAppModule(() => import("../../src/app/actions/presence"));
});

const projects: string[] = [];
after(async () => {
  for (const id of projects) await sql`DELETE FROM projects WHERE id = ${id}`;
  await sql.end();
  await closeAppDb();
});

test("realtime is true only for people the Realtime policy lets the viewer observe", async () => {
  const [viewer, teammate, hidden, stranger] = await Promise.all([1, 2, 3, 4].map(() => sql.begin((tx) => createUser(tx))));
  const project = await sql.begin((tx) => createProject(tx, viewer!));
  projects.push(project);
  await sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${project}, ${viewer!}, 'owner'), (${project}, ${teammate!}, 'member'), (${project}, ${hidden!}, 'member')`;
  await sql`UPDATE profiles SET show_activity = (id <> ${hidden!}) WHERE id IN (${viewer!}, ${teammate!}, ${hidden!}, ${stranger!})`;

  viewerId = viewer!;
  const result = await presence.getPresence({ userIds: [teammate!, hidden!, stranger!, viewer!] });
  assert.equal(result.success, true);
  const realtime = Object.fromEntries((result.success ? result.presence : []).map((p) => [p.userId, p.realtime]));
  assert.deepEqual(realtime, {
    [teammate!]: true, // shared project, both show activity
    [hidden!]: false, // hides their activity
    [stranger!]: false, // no shared chat or project
    [viewer!]: false, // the viewer's own room is published by PresenceProvider, never watched by a badge
  });
});
