import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Report Part B: each read path that sends "with Claude Code", for each setting × the person, a teammate and the
// owner; and the record itself never changes.
let viewerId = "";
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: {
    getUser: async () => ({ data: { user: viewerId ? { id: viewerId, user_metadata: {} } : null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  } }),
  createAdminClient: async () => { throw new Error("not used"); },
});
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
moduleStubs.set("next/headers", { headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }) });

let comments: typeof import("../../src/lib/domain/task-comments");
let subtasks: typeof import("../../src/app/actions/subtask");
let versions: typeof import("../../src/app/actions/files/versions");
let recent: typeof import("../../src/app/actions/workspace/recent-activity");
let agentSettings: typeof import("../../src/app/actions/workspace/agents");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  const viewer = () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true });
  moduleStubs.set("@/lib/server/viewer-context", { ...viewerContext, getViewerAuthContext: async () => viewer(), getViewerIdentityContext: async () => ({ ...viewer(), profile: null }) });
  comments = await loadAppModule(() => import("../../src/lib/domain/task-comments"));
  subtasks = await loadAppModule(() => import("../../src/app/actions/subtask"));
  versions = await loadAppModule(() => import("../../src/app/actions/files/versions"));
  recent = await loadAppModule(() => import("../../src/app/actions/workspace/recent-activity"));
  agentSettings = await loadAppModule(() => import("../../src/app/actions/workspace/agents"));
});
after(async () => { await sql.end(); await closeAppDb(); });

async function world() {
  const [owner, person, teammate] = await Promise.all([1, 2, 3].map(() => sql.begin((tx) => createUser(tx))));
  const ws = await sql.begin((tx) => createProject(tx, owner!));
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${person!}, 'member'), (${ws}, ${teammate!}, 'member')`;
  const [task] = await sql`INSERT INTO tasks (workspace_id, title, status, assignee_id, creator_id) VALUES (${ws}, 'Fix login', 'in_progress', ${person!}, ${person!}) RETURNING id`;
  const agent = { via: "agent", agent_name: "Claude Code" };
  await sql`INSERT INTO task_comments (task_id, user_id, content, via, agent_name) VALUES (${task!.id}, ${person!}, 'Done the first part', ${agent.via}, ${agent.agent_name})`;
  const [sub] = await sql`INSERT INTO task_subtasks (task_id, title, via, agent_name, created_by) VALUES (${task!.id}, 'Write tests', ${agent.via}, ${agent.agent_name}, ${person!}) RETURNING id`;
  const [node] = await sql`INSERT INTO workspace_nodes (workspace_id, type, name, path, created_by) VALUES (${ws}, 'file', 'login.ts', '/login.ts', ${person!}) RETURNING id`;
  await sql`INSERT INTO file_versions (node_id, version, s3_key, size, mime_type, uploaded_by, content_hash, via, agent_name)
            VALUES (${node!.id}, 1, ${`projects/${ws}/files/login.ts`}, 10, 'text/plain', ${person!}, ${"a".repeat(64)}, ${agent.via}, ${agent.agent_name})`;
  await sql`INSERT INTO task_activity_events (workspace_id, task_id, actor_id, event_type, payload)
            VALUES (${ws}, ${task!.id}, ${person!}, 'status_changed', ${sql.json({ to: "in_progress", via: "agent", agentName: "Claude Code" })})`;
  return { owner: owner!, person: person!, teammate: teammate!, ws, taskId: task!.id as string, subId: sub!.id as string, nodeId: node!.id as string };
}

async function seen(w: Awaited<ReturnType<typeof world>>, viewer: string) {
  viewerId = viewer;
  const discussion = await comments.readTaskDiscussionInternal({ projectId: w.ws, taskId: w.taskId, viewerId: viewer });
  const labels = await subtasks.readTaskSubtaskLabelsAction(w.ws, w.taskId, [w.subId]);
  const page = await versions.listFileVersionsPage(w.ws, w.nodeId);
  const activity = await recent.readWorkspaceRecentActivityAction(w.ws);
  return {
    comment: discussion.comments[0]?.via ?? null,
    subtask: labels[w.subId]?.via ?? null,
    version: page.versions[0]?.via ?? null,
    activity: activity.find((a) => a.type === "task")?.via ?? null,
  };
}

const all = (v: "agent" | null) => ({ comment: v, subtask: v, version: v, activity: v });

test("Everyone, Only the person and No one, for the person, a teammate and the owner, on every read path", async () => {
  const w = await world();
  const expected = {
    everyone: { person: "agent", teammate: "agent", owner: "agent" },
    person: { person: "agent", teammate: null, owner: null },
    none: { person: null, teammate: null, owner: null },
  } as const;
  for (const setting of ["everyone", "person", "none"] as const) {
    await sql`UPDATE workspaces SET agent_label_visibility = ${setting} WHERE id = ${w.ws}`;
    for (const who of ["person", "teammate", "owner"] as const) {
      assert.deepEqual(await seen(w, w[who]), all(expected[setting][who]), `${setting} · ${who}`);
    }
  }
});

test("the record never changes: hiding labels leaves via and agent_name stored", async () => {
  const w = await world();
  await sql`UPDATE workspaces SET agent_label_visibility = 'none' WHERE id = ${w.ws}`;
  await seen(w, w.teammate);
  const [c] = await sql`SELECT via, agent_name FROM task_comments WHERE task_id = ${w.taskId}`;
  const [s] = await sql`SELECT via, agent_name FROM task_subtasks WHERE id = ${w.subId}`;
  assert.deepEqual([c!.via, c!.agent_name, s!.via, s!.agent_name], ["agent", "Claude Code", "agent", "Claude Code"]);
});

test("only the owner chooses who sees agent help; admins see the choice", async () => {
  const w = await world();
  await sql`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = ${w.ws} AND user_id = ${w.teammate}`;
  viewerId = w.owner;
  const read = await agentSettings.getWorkspaceAgentSettingsAction(w.ws);
  assert.ok(read.success && read.labels === "everyone" && read.canChangeLabels && !read.inOrganization);
  assert.equal((await agentSettings.updateWorkspaceAgentSettingsAction({ projectId: w.ws, labels: "person" })).success, true);
  viewerId = w.teammate;
  const asAdmin = await agentSettings.getWorkspaceAgentSettingsAction(w.ws);
  assert.ok(asAdmin.success && asAdmin.labels === "person" && !asAdmin.canChangeLabels);
  const refused = await agentSettings.updateWorkspaceAgentSettingsAction({ projectId: w.ws, labels: "none" });
  assert.equal(refused.success, false);
  viewerId = w.person;
  assert.equal((await agentSettings.updateWorkspaceAgentSettingsAction({ projectId: w.ws, labels: "none" })).success, false, "members can't");
  const [row] = await sql`SELECT agent_label_visibility FROM workspaces WHERE id = ${w.ws}`;
  assert.equal(row!.agent_label_visibility, "person");
});
