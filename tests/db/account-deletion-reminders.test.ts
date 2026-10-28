import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Real database. A pending deletion is reminded 7 days and then 1 day before it happens, once each.
process.env.RESEND_EMAIL_ENABLED = "true";
moduleStubs.set("@/inngest/client", { inngest: { send: async () => undefined } });
let reminders: typeof import("@/lib/account/deletion-reminders");
const created: string[] = [];
const DAY = 86_400_000;

before(async () => {
  reminders = await loadAppModule(() => import("@/lib/account/deletion-reminders"));
});
afterEach(async () => {
  if (created.length) {
    await sql`DELETE FROM public.email_outbox WHERE user_id IN ${sql(created)}`;
    await sql`DELETE FROM public.account_deletions WHERE user_id IN ${sql(created)}`;
    await sql`DELETE FROM auth.users WHERE id IN ${sql(created)}`;
  }
  created.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

async function pendingDeletion(msUntil: number, scheduledDaysAgo = 20) {
  const id = await sql.begin((tx) => createUser(tx, {}));
  created.push(id);
  const now = Date.now();
  await sql`
    INSERT INTO public.account_deletions (user_id, email, scheduled_at, hard_delete_at, legal_retention_until)
    VALUES (${id}, ${`${id}@example.com`}, ${new Date(now - scheduledDaysAgo * DAY)}, ${new Date(now + msUntil)}, ${new Date(now + 200 * DAY)})`;
  return id;
}
const queued = async (userId: string) => (await sql`SELECT kind, data FROM public.email_outbox WHERE user_id = ${userId} ORDER BY created_at`) as unknown as Array<{ kind: string; data: { daysLeft: number } }>;

test("a deletion six days away gets the 7-day reminder, once", async () => {
  const user = await pendingDeletion(6 * DAY);
  await reminders.runAccountDeletionReminders();
  await reminders.runAccountDeletionReminders();
  const rows = await queued(user);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.kind, "account_deletion_reminder");
  assert.equal(rows[0]!.data.daysLeft, 6, "the email says how many days are really left");
});

test("a deletion half a day away gets the 1-day reminder, not the 7-day one", async () => {
  const user = await pendingDeletion(DAY / 2);
  await reminders.runAccountDeletionReminders();
  const rows = await queued(user);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.data.daysLeft, 1);
});

test("a deletion far away, or scheduled today, gets nothing", async () => {
  const far = await pendingDeletion(20 * DAY);
  const fresh = await pendingDeletion(6 * DAY, 0);
  await reminders.runAccountDeletionReminders();
  assert.equal((await queued(far)).length, 0);
  assert.equal((await queued(fresh)).length, 0, "the scheduled email already went out today");
});

test("a cancelled deletion gets nothing", async () => {
  const user = await pendingDeletion(3 * DAY);
  await sql`UPDATE public.account_deletions SET cancelled_at = now() WHERE user_id = ${user}`;
  await reminders.runAccountDeletionReminders();
  assert.equal((await queued(user)).length, 0);
});
