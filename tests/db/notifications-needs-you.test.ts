import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// Notifications mix: Needs you is read from the things themselves, so it stays until each one is answered.
let needs: typeof import("../../src/lib/notifications/needs-you");
before(async () => { needs = await loadAppModule(() => import("../../src/lib/notifications/needs-you")); });
const made: string[] = [];
afterEach(async () => {
  await sql`DELETE FROM workspaces WHERE owner_id = ANY(${made})`;
  await sql`DELETE FROM auth.users WHERE id = ANY(${made})`;
  made.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

async function seed() {
  const [me, author, applicant] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx)]);
  made.push(me, author, applicant);
  const ws = await sql.begin((tx) => createProject(tx, me));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${author}, 'member')`;
  const [src] = await sql`INSERT INTO branches (workspace_id, name, created_by) VALUES (${ws}, 'feature/heap-sort', ${author}) RETURNING id`;
  const [dst] = await sql`INSERT INTO branches (workspace_id, name, created_by) VALUES (${ws}, 'main-x', ${author}) RETURNING id`;
  const [mr] = await sql`INSERT INTO merge_requests (workspace_id, number, source_branch_id, target_branch_id, title, author_id)
    VALUES (${ws}, 12, ${src!.id}, ${dst!.id}, 'Heap sort', ${author}) RETURNING id`;
  await sql`INSERT INTO merge_request_reviews (merge_request_id, reviewer_id) VALUES (${mr!.id}, ${me})`;
  const [conn] = await sql`INSERT INTO connections (requester_id, addressee_id, status) VALUES (${author}, ${me}, 'pending') RETURNING id`;
  await sql`INSERT INTO role_applications (workspace_id, applicant_id, creator_id, status, message) VALUES (${ws}, ${applicant}, ${me}, 'pending', 'hi')`;
  await sql`INSERT INTO agent_questions (workspace_id, asker_user_id, agent_name, to_role, to_user_id, questions, expires_at)
    VALUES (${ws}, ${me}, 'Claude', 'me', ${me}, ${sql.json([{ key: "cache", header: "Cache", question: "Use Postgres or SQLite?", options: [{ value: "sqlite", label: "SQLite", recommended: true }, { value: "pg", label: "Postgres" }] }])}, now() + interval '1 day')`;
  const [session] = await sql`INSERT INTO extension_device_sessions (user_id, token_hash, token_prefix, device_name, client_version, expires_at, token_type, agent_name)
    VALUES (${me}, ${randomUUID()}, 'nb_x', 'laptop', '2.0.0', now() + interval '1 day', 'device', 'Claude') RETURNING id`;
  await sql`INSERT INTO agent_access_requests (session_id, user_id, scope, method, path, expires_at)
    VALUES (${session!.id}, ${me}, 'files:write', 'POST', '/api/v1/x', now() + interval '1 hour')`;
  await sql`INSERT INTO user_notifications (user_id, kind, importance, title, dedupe_key)
    VALUES (${me}, 'trust_safety', 'important', 'A report on your post was reviewed', ${`ts:${randomUUID()}`})`;
  await sql`INSERT INTO user_notifications (user_id, kind, importance, title, dedupe_key)
    VALUES (${me}, 'project_update_like', 'more', 'Rama liked your post', ${`like:${randomUUID()}`})`;
  return { me, author, conn: conn!.id as string };
}

test("Needs you lists each open review, request, agent ask and important notice once, and counts them", async () => {
  const { me, author, conn } = await seed();
  const items = await needs.readNeedsYou(me);
  assert.deepEqual(items.map((i) => i.source).sort(), ["agent_access", "agent_question", "application", "connection", "important", "review"]);
  assert.equal(await needs.countNeedsYou(me), 6);
  const review = items.find((i) => i.source === "review")!;
  assert.equal(review.sentence.object, "!12 Heap sort");
  assert.equal(review.primary?.label, "Review");
  const question = items.find((i) => i.source === "agent_question")!;
  assert.deepEqual(question.options?.map((o) => o.label), ["SQLite", "Postgres"]);
  assert.equal(question.options?.[0]?.recommended, true);
  assert.equal(items.find((i) => i.source === "connection")!.primary?.act, "accept");
  assert.equal(await needs.countNeedsYou(author), 0, "someone else's things never show");

  // Answered elsewhere (the Network page): it leaves Needs you on the next read.
  await sql`UPDATE connections SET status = 'accepted', accepted_at = now() WHERE id = ${conn}`;
  assert.equal(await needs.countNeedsYou(me), 5);
  assert.equal((await needs.readNeedsYou(me)).some((i) => i.source === "connection"), false);
});

test("an agent ask with several questions is answered in chat, not with the first question's options", async () => {
  const { me } = await seed();
  const ws = (await sql`SELECT id FROM workspaces WHERE owner_id = ${me} LIMIT 1`)[0]!.id;
  await sql`UPDATE agent_questions SET status = 'cancelled' WHERE to_user_id = ${me}`;
  await sql`INSERT INTO agent_questions (workspace_id, asker_user_id, agent_name, to_role, to_user_id, questions, expires_at)
    VALUES (${ws}, ${me}, 'Claude', 'me', ${me}, ${sql.json([
      { key: "a", header: "A", question: "First?", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] },
      { key: "b", header: "B", question: "Second?", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] },
    ])}, now() + interval '1 day')`;
  const ask = (await needs.readNeedsYou(me)).find((i) => i.source === "agent_question")!;
  assert.deepEqual(ask.options ?? [], []);
  assert.equal(ask.secondary?.label, "Answer in chat");
  assert.equal(ask.snippet, "First? (and 1 more question)");
});

test("an important notice stays in Needs you until it is read, through Mark all read", async () => {
  const { me } = await seed();
  const service = await loadAppModule(() => import("../../src/lib/notifications/service"));
  await service.markAllNotificationsRead(me, undefined, { keepImportant: true });
  assert.equal((await needs.readNeedsYou(me)).some((i) => i.source === "important"), true, "still there after Mark all read");
  const id = (await needs.readNeedsYou(me)).find((i) => i.source === "important")!.notificationId!;
  await service.markNotificationRead(me, id);
  assert.equal((await needs.readNeedsYou(me)).some((i) => i.source === "important"), false, "gone once read");
});
