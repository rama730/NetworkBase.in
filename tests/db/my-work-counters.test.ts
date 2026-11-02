import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Real database: both counter writers name their columns in raw SQL, so only the real schema can catch a wrong name.
const inngestStub = { inngest: { createFunction: (...args: unknown[]) => args, send: async () => undefined } };
moduleStubs.set("@/inngest/client", inngestStub);
moduleStubs.set("../client", inngestStub);
let counters: typeof import("@/lib/my-work/profile-counters");
let appDb: typeof import("@/lib/db").db;
const created: string[] = [];

before(async () => {
  counters = await loadAppModule(() => import("@/lib/my-work/profile-counters"));
  appDb = (await loadAppModule(() => import("@/lib/db"))).db;
});
afterEach(async () => {
  if (created.length) {
    await sql`DELETE FROM public.connections WHERE requester_id IN ${sql(created)} OR addressee_id IN ${sql(created)}`;
    await sql`DELETE FROM auth.users WHERE id IN ${sql(created)}`;
  }
  created.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

test("a counter refresh writes the inbox count for a pending connection", async () => {
  const [requester, addressee] = await sql.begin(async (tx) => [await createUser(tx, {}), await createUser(tx, {})]);
  created.push(requester!, addressee!);
  await sql`INSERT INTO public.connections (requester_id, addressee_id, status) VALUES (${requester!}, ${addressee!}, 'pending')`;

  await counters.refreshMyWorkCountersForUsers(appDb, [addressee!]);

  const [row] = await sql`SELECT my_work_inbox_count FROM public.profiles WHERE id = ${addressee!}`;
  assert.equal(row!.my_work_inbox_count, 1);
});

test("a refresh inside a transaction commits, as accepting a connection does", async () => {
  const userId = await sql.begin((tx) => createUser(tx, {}));
  created.push(userId);
  await appDb.transaction((tx) => counters.refreshMyWorkCountersForUsers(tx, [userId]));
});

test("the nightly job finishes both steps and repairs a drifted count", async () => {
  const [requester, addressee] = await sql.begin(async (tx) => [await createUser(tx, {}), await createUser(tx, {})]);
  created.push(requester!, addressee!);
  await sql`INSERT INTO public.connections (requester_id, addressee_id, status) VALUES (${requester!}, ${addressee!}, 'pending')`;
  await sql`UPDATE public.profiles SET connections_count = 9 WHERE id = ${addressee!}`;

  const { reconcileMyWorkProfileCounters } = await loadAppModule(() => import("@/inngest/functions/my-work-counter-reconcile"));
  const handler = (reconcileMyWorkProfileCounters as unknown as unknown[])[2] as (input: unknown) => Promise<unknown>;
  await handler({ step: { run: (_id: string, run: () => Promise<unknown>) => run() } });

  const [row] = await sql`SELECT my_work_inbox_count, connections_count FROM public.profiles WHERE id = ${addressee!}`;
  assert.equal(row!.my_work_inbox_count, 1);
  assert.equal(row!.connections_count, 0);
});
