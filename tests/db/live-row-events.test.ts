import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { actAs, actAsOwner, addMember, createProject, createUser, inRollback, projectWithPeople, sql, type Tx } from "./_helpers";

after(() => sql.end());

const events = (tx: Tx, topic: string) =>
  tx<{ event: string; payload: Record<string, any>; private: boolean }[]>`SELECT event, payload, private FROM realtime.messages WHERE topic = ${topic} ORDER BY id`;

/** Realtime's join check: can this viewer read a broadcast row on the topic? */
async function canJoin(tx: Tx, viewer: string, topic: string) {
  await tx`SELECT realtime.send('{}'::jsonb, 'probe', ${topic}, true)`;
  await tx`SELECT set_config('realtime.topic', ${topic}, true)`;
  await actAs(tx, viewer);
  const rows = await tx`SELECT 1 FROM realtime.messages WHERE topic = ${topic} AND extension = 'broadcast' LIMIT 1`;
  await actAsOwner(tx);
  return rows.length > 0;
}

test("task writes reach the board and the task's own topic, privately and without text", async () => {
  await inRollback(async (tx) => {
    const { projectId, owner } = await projectWithPeople(tx);
    const id = randomUUID();
    await tx`INSERT INTO public.tasks (id, workspace_id, title, creator_id) VALUES (${id}, ${projectId}, 'SECRET TITLE', ${owner})`;
    await tx`UPDATE public.tasks SET description = 'SECRET BODY' WHERE id = ${id}`;
    await tx`DELETE FROM public.tasks WHERE id = ${id}`;
    const board = await events(tx, `live:tasks:${projectId}`);
    assert.deepEqual(board.filter((e) => e.event === "task.changed").map((e) => e.payload), [
      { op: "INSERT", id }, { op: "UPDATE", id }, { op: "DELETE", id },
    ]);
    assert.ok(board.every((e) => e.private));
    assert.equal((await events(tx, `live:task:${id}`)).length, 3);
    assert.doesNotMatch(JSON.stringify(board), /SECRET/);
  });
});

test("comment, subtask and file-link events carry what the panel counts and no text", async () => {
  await inRollback(async (tx) => {
    const { projectId, owner } = await projectWithPeople(tx);
    const task = randomUUID();
    await tx`INSERT INTO public.tasks (id, workspace_id, title) VALUES (${task}, ${projectId}, 't')`;
    const [comment] = await tx`INSERT INTO public.task_comments (task_id, user_id, content) VALUES (${task}, ${owner}, 'SECRET COMMENT') RETURNING id`;
    await tx`UPDATE public.task_comments SET deleted_at = now(), deleted_by = ${owner} WHERE id = ${comment!.id}`;
    const [subtask] = await tx`INSERT INTO public.task_subtasks (task_id, title) VALUES (${task}, 'SECRET STEP') RETURNING id`;
    await tx`UPDATE public.task_subtasks SET completed = true WHERE id = ${subtask!.id}`;
    const [node] = await tx`INSERT INTO public.workspace_nodes (workspace_id, type, name) VALUES (${projectId}, 'file', 'SECRET NAME') RETURNING id`;
    await tx`INSERT INTO public.task_node_links (task_id, node_id) VALUES (${task}, ${node!.id})`;

    const all = await events(tx, `live:task:${task}`);
    assert.doesNotMatch(JSON.stringify(all), /SECRET/);
    const comments = all.filter((e) => e.event === "comment.changed");
    assert.equal(comments[0]!.payload.op, "INSERT");
    assert.equal(comments[0]!.payload.old, null);
    assert.equal(comments[1]!.payload.old.deleted_at, null);
    assert.ok(comments[1]!.payload.new.deleted_at);
    assert.equal(comments[1]!.payload.new.deleted_by, owner);
    const steps = all.filter((e) => e.event === "subtask.changed");
    assert.deepEqual(steps[1]!.payload, {
      op: "UPDATE", new: { id: subtask!.id, completed: true }, old: { id: subtask!.id, completed: false },
    });
    assert.deepEqual(all.filter((e) => e.event === "attachment.changed").map((e) => e.payload), [{ op: "INSERT" }]);
  });
});

test("notification events go to their owner alone, with the kind but no text", async () => {
  await inRollback(async (tx) => {
    const [me, other] = [await createUser(tx), await createUser(tx)];
    const [row] = await tx`INSERT INTO public.user_notifications (user_id, kind, title, body, dedupe_key)
                           VALUES (${me}, 'task_assigned', 'SECRET', 'SECRET', ${randomUUID()}) RETURNING id, activity_at`;
    await tx`UPDATE public.user_notifications SET read_at = now() WHERE id = ${row!.id}`;
    await tx`DELETE FROM public.user_notifications WHERE id = ${row!.id}`;
    const sent = (await events(tx, `chat:user:${me}`)).filter((e) => e.event === "notification.changed");
    assert.deepEqual(sent.map((e) => e.payload.op), ["INSERT", "UPDATE", "DELETE"]);
    assert.equal(sent[0]!.payload.new.kind, "task_assigned");
    assert.equal(sent[2]!.payload.new, null);
    assert.equal(sent[2]!.payload.old.id, row!.id);
    assert.doesNotMatch(JSON.stringify(sent), /SECRET/);
    assert.equal(await canJoin(tx, me, `chat:user:${me}`), true);
    assert.equal(await canJoin(tx, other, `chat:user:${me}`), false);
  });
});

test("a profile only announces the fields screens show, and a workspace only its live numbers", async () => {
  await inRollback(async (tx) => {
    const { owner, projectId } = await projectWithPeople(tx);
    const profileEvents = async () => (await events(tx, `chat:user:${owner}`)).filter((e) => e.event === "profile.changed").length;
    await tx`UPDATE public.profiles SET bio = 'x' WHERE id = ${owner}`;
    assert.equal(await profileEvents(), 0);
    await tx`UPDATE public.profiles SET full_name = 'New Name' WHERE id = ${owner}`;
    assert.equal(await profileEvents(), 1);

    const topic = `live:workspace:${projectId}`;
    await tx`UPDATE public.workspaces SET description = 'SECRET' WHERE id = ${projectId}`;
    assert.equal((await events(tx, topic)).length, 0);
    await tx`UPDATE public.workspaces SET view_count = view_count + 1 WHERE id = ${projectId}`;
    await tx`UPDATE public.workspaces SET import_source = '{"metadata":{"hydration":{"status":"in_progress"},"token":"SECRET"}}' WHERE id = ${projectId}`;
    const sent = await events(tx, topic);
    assert.equal(sent.length, 2);
    assert.deepEqual(Object.keys(sent[0]!.payload).sort(), ["current_stage_index", "followers_count", "stage_completion_dates", "updated_at", "view_count"]);
    assert.doesNotMatch(JSON.stringify(sent), /SECRET/);
  });
});

test("each live topic follows the read rule of the table it announces", async () => {
  await inRollback(async (tx) => {
    const { owner, member, outsider, projectId } = await projectWithPeople(tx, { publicTabVisibility: { tasks: false } });
    const task = randomUUID();
    await tx`INSERT INTO public.tasks (id, workspace_id, title) VALUES (${task}, ${projectId}, 't')`;
    // Workspace: anyone who can read it. Tasks hidden from the public: members only. Locks: members only, always.
    assert.equal(await canJoin(tx, outsider, `live:workspace:${projectId}`), true);
    assert.equal(await canJoin(tx, outsider, `live:tasks:${projectId}`), false);
    assert.equal(await canJoin(tx, outsider, `live:task:${task}`), false);
    assert.equal(await canJoin(tx, outsider, `live:files:${projectId}`), false);
    for (const viewer of [owner, member]) {
      assert.equal(await canJoin(tx, viewer, `live:tasks:${projectId}`), true);
      assert.equal(await canJoin(tx, viewer, `live:task:${task}`), true);
      assert.equal(await canJoin(tx, viewer, `live:files:${projectId}`), true);
    }
    const open = await createProject(tx, owner, { publicTabVisibility: { tasks: true } });
    assert.equal(await canJoin(tx, outsider, `live:tasks:${open}`), true);
    assert.equal(await canJoin(tx, outsider, `live:files:${open}`), false);

    const hidden = await createProject(tx, owner, { visibility: "private", status: "active" });
    assert.equal(await canJoin(tx, outsider, `live:workspace:${hidden}`), false);
    await addMember(tx, hidden, outsider);
    assert.equal(await canJoin(tx, outsider, `live:workspace:${hidden}`), true);

    assert.equal(await canJoin(tx, owner, "live:tasks:not-a-uuid"), false);
    assert.equal(await canJoin(tx, owner, `live:other:${projectId}`), false);
  });
});

test("file lock events reach the workspace's files topic without tokens", async () => {
  await inRollback(async (tx) => {
    const { owner, projectId } = await projectWithPeople(tx);
    const [node] = await tx`INSERT INTO public.workspace_nodes (workspace_id, type, name) VALUES (${projectId}, 'file', 'a') RETURNING id`;
    await tx`INSERT INTO public.workspace_node_locks (node_id, workspace_id, locked_by, expires_at, session_id)
             VALUES (${node!.id}, ${projectId}, ${owner}, now() + interval '5 minutes', ${randomUUID()})`;
    const sent = await events(tx, `live:files:${projectId}`);
    assert.deepEqual(sent.map((e) => [e.event, e.payload]), [["lock.changed", {}]]);
  });
});

test("a failing announcement never fails the write", async () => {
  await inRollback(async (tx) => {
    const { projectId } = await projectWithPeople(tx);
    await tx.unsafe("ALTER TABLE realtime.messages RENAME TO messages_gone");
    const [row] = await tx`INSERT INTO public.tasks (workspace_id, title) VALUES (${projectId}, 'kept') RETURNING title`;
    assert.equal(row!.title, "kept");
  });
});

test("no browser role can run the senders", async () => {
  const rows = await sql`
    SELECT r.role, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
      (VALUES ('anon'), ('authenticated')) AS r(role)
    WHERE n.nspname = 'app_private' AND p.proname LIKE 'live\\_%' AND has_function_privilege(r.role, p.oid, 'EXECUTE')`;
  assert.equal(rows.length, 0);
});

test("decision 145: an organization copy's changes reach its people on their own topic, never the organization's board topic", async () => {
  await inRollback(async (tx) => {
    const { projectId, owner } = await projectWithPeople(tx);
    const [student, classmate] = [await createUser(tx), await createUser(tx)];
    await addMember(tx, projectId, student);
    await addMember(tx, projectId, classmate);
    await tx`UPDATE public.workspaces SET kind = 'organization' WHERE id = ${projectId}`;
    const master = randomUUID();
    const copy = randomUUID();
    await tx`INSERT INTO public.tasks (id, workspace_id, title, kind, creator_id) VALUES (${master}, ${projectId}, 'Lab', 'assignment', ${owner})`;
    await tx`INSERT INTO public.tasks (id, workspace_id, title, assignment_id, assignee_id) VALUES (${copy}, ${projectId}, 'Lab', ${master}, ${student})`;
    await tx`UPDATE public.tasks SET status = 'in_progress' WHERE id = ${copy}`;
    const board = await events(tx, `live:tasks:${projectId}`);
    assert.deepEqual(board.filter((e) => e.event === "task.changed").map((e) => e.payload.id), [master], "only the main assignment reaches the whole organization");
    const mine = (await events(tx, `chat:user:${student}`)).filter((e) => e.event === "task.changed");
    assert.deepEqual(mine.map((e) => [e.payload.op, e.payload.id, e.payload.workspace_id]), [["INSERT", copy, projectId], ["UPDATE", copy, projectId]]);
    assert.equal((await events(tx, `chat:user:${classmate}`)).length, 0, "a classmate hears nothing");
    assert.equal((await events(tx, `live:task:${copy}`)).length, 2, "the copy's own topic still works for whoever may open it");
  });
});
