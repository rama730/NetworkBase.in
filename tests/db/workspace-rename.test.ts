import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

import { actAs, actAsOwner, createUser, grantBrowserRead, inRollback, sql } from "./_helpers";

// Migration 0264 (terminology report §12.3–12.4, §15 #1): projects become workspaces.
after(() => sql.end());

const OLD_TABLES: Record<string, string> = {
  projects: "workspaces", project_members: "workspace_members", project_invitations: "workspace_invitations",
  project_guidance_appointments: "workspace_mentors", project_open_roles: "workspace_open_roles", project_follows: "workspace_follows",
  project_skills: "workspace_skills", project_tags: "workspace_tags", project_docs: "workspace_documents",
  project_doc_versions: "workspace_document_versions", project_updates: "workspace_updates", project_update_comments: "workspace_update_comments",
  project_update_likes: "workspace_update_likes", project_update_media_assets: "workspace_update_media_assets",
  project_update_drafts: "workspace_update_drafts", project_update_draft_media_assets: "workspace_update_draft_media_assets",
  project_sprints: "workspace_sprints", project_sprint_events: "workspace_sprint_events", project_workflow_columns: "workspace_workflow_columns",
  project_task_policy_events: "workspace_task_policy_events", project_nodes: "workspace_nodes", project_node_events: "workspace_node_events",
  project_node_locks: "workspace_node_locks", project_node_conflicts: "workspace_node_conflicts", project_file_index: "workspace_file_index",
  project_git_deltas: "workspace_git_deltas", project_event_counters: "workspace_event_counters",
  profile_project_contributions: "profile_contributions", profile_project_contribution_stages: "profile_contribution_stages",
};
const OLD_COLUMNS = ["project_id", "source_project_id", "child_project_id", "project_count", "projects_count", "visible_project_count", "lead_user_id"];

/** Identifiers a function body uses, outside string literals, comments, dollar-quoted blocks and `AS alias`. */
function bodyIdentifiers(src: string): string[] {
  const code = src.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\bAS\s+"?[a-z_][a-z0-9_]*"?/gi, "AS _");
  return code.match(/[a-z_][a-z0-9_]*/gi) ?? [];
}

test("every renamed table and column exists under its new name", async () => {
  const tables = await sql<{ relname: string }[]>`SELECT relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','p')`;
  const have = new Set(tables.map((t) => t.relname));
  for (const [from, to] of Object.entries(OLD_TABLES)) {
    assert.ok(have.has(to), `table ${to}`);
    assert.ok(!have.has(from), `${from} is no longer a table`);
  }
  const cols = await sql<{ table_name: string; column_name: string }[]>`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN pg_class r ON r.relname = c.table_name AND r.relnamespace = 'public'::regnamespace AND r.relkind IN ('r','p')
    WHERE c.table_schema = 'public' AND c.column_name = ANY(${OLD_COLUMNS})`;
  assert.deepEqual([...cols], [], "no table keeps an old column name");
  const [type] = await sql`SELECT 1 FROM pg_type WHERE typname = 'status_workspace' AND typnamespace = 'public'::regnamespace`;
  assert.ok(type, "status_workspace type");
});

test("no function body still names a renamed table, column or function", async () => {
  const fns = await sql<{ proname: string; prosrc: string; args: string[] | null }[]>`
    SELECT p.proname, p.prosrc, p.proargnames AS args FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.pronamespace = 'public'::regnamespace AND l.lanname IN ('plpgsql', 'sql')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`;
  const oldNames = new Set([...Object.keys(OLD_TABLES), ...OLD_COLUMNS]);
  for (const f of fns) if (/project/.test(f.proname)) oldNames.add(f.proname);
  const stale: string[] = [];
  for (const f of fns) {
    assert.ok(!/project/.test(f.proname), `function ${f.proname} keeps "project" in its name`);
    const own = new Set(f.args ?? []);
    const hits = [...new Set(bodyIdentifiers(f.prosrc).filter((w) => oldNames.has(w) && !own.has(w)))];
    if (hits.length) stale.push(`${f.proname}: ${hits.join(", ")}`);
  }
  assert.deepEqual(stale, []);
});

test("each old table name is a security_invoker view with the old column names", async () => {
  const views = await sql<{ relname: string; reloptions: string[] | null }[]>`
    SELECT relname, reloptions FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'v' AND relname = ANY(${Object.keys(OLD_TABLES)})`;
  assert.equal(views.length, Object.keys(OLD_TABLES).length);
  for (const v of views) assert.ok(v.reloptions?.includes("security_invoker=true"), `${v.relname} security_invoker`);
  const [col] = await sql`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_members' AND column_name = 'project_id'`;
  assert.ok(col, "project_members view keeps project_id");
});

test("a non-member sees no private workspace through the old projects view", async () => {
  await inRollback(async (tx) => {
    const owner = await createUser(tx);
    const outsider = await createUser(tx);
    const id = randomUUID();
    await tx`INSERT INTO public.workspaces (id, owner_id, title, slug, visibility, status)
             VALUES (${id}, ${owner}, 'Private', ${`w-${id}`}, 'private', 'active')`;
    await tx`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (${id}, ${owner}, 'owner')`;
    await grantBrowserRead(tx, ["projects", "workspaces"]);
    await actAs(tx, outsider);
    assert.equal((await tx`SELECT id FROM public.projects WHERE id = ${id}`).length, 0, "outsider through the view");
    assert.equal((await tx`SELECT id FROM public.workspaces WHERE id = ${id}`).length, 0, "outsider through the table");
    await actAs(tx, owner);
    assert.equal((await tx`SELECT id FROM public.projects WHERE id = ${id}`).length, 1, "owner through the view");
    await actAsOwner(tx);
  });
});

test("the owner membership row is canonical: workspaces.owner_id follows it and there is only one", async () => {
  await inRollback(async (tx) => {
    const a = await createUser(tx);
    const b = await createUser(tx);
    const id = randomUUID();
    await tx`INSERT INTO public.workspaces (id, owner_id, title, slug, visibility, status)
             VALUES (${id}, ${a}, 'Owned', ${`w-${id}`}, 'public', 'active')`;
    await tx`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (${id}, ${a}, 'owner'), (${id}, ${b}, 'member')`;
    await tx`UPDATE public.workspace_members SET role = 'admin' WHERE workspace_id = ${id} AND user_id = ${a}`;
    await tx`UPDATE public.workspace_members SET role = 'owner' WHERE workspace_id = ${id} AND user_id = ${b}`;
    const [row] = await tx`SELECT owner_id FROM public.workspaces WHERE id = ${id}`;
    assert.equal(row!.owner_id, b);
    await assert.rejects(
      tx.savepoint((sp) => sp`UPDATE public.workspace_members SET role = 'owner' WHERE workspace_id = ${id} AND user_id = ${a}`),
      /workspace_members_one_owner/,
    );
  });
});

test("0265: stored values say workspace; founder and old document visibility are gone", async () => {
  await inRollback(async (tx) => {
    const owner = await createUser(tx);
    const id = randomUUID();
    await tx`INSERT INTO public.workspaces (id, owner_id, title, slug) VALUES (${id}, ${owner}, 'Kind', ${`w-${id}`})`;
    const [row] = await tx`SELECT kind FROM public.workspaces WHERE id = ${id}`;
    assert.equal(row!.kind, "workspace");
    await assert.rejects(tx.savepoint((sp) => sp`UPDATE public.workspaces SET kind = 'project' WHERE id = ${id}`), /workspaces_kind_check/);
    await assert.rejects(tx.savepoint((sp) => sp`UPDATE public.profiles SET experience_level = 'founder' WHERE id = ${owner}`), /profiles_experience_level_check/);
    const [doc] = await tx`SELECT column_default FROM information_schema.columns WHERE table_name = 'workspace_documents' AND column_name = 'settings'`;
    assert.match(String(doc!.column_default), /"inherit_workspace"/);
    const [reason] = await tx`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'content_reports_reason_check'`;
    assert.match(String(reason!.def), /hate_speech/);
    const stale = await tx`SELECT proname FROM pg_proc WHERE prosrc LIKE '%inherit_project%'`;
    assert.deepEqual([...stale], []);
  });
});
