import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { Webhook } from "svix";
import { NextRequest } from "next/server";
import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";
import { emailOutbox, profiles } from "@/lib/db/schema";
import { buildEmail, MAX_ATTEMPTS, RETRY_WINDOW_MS, type ResendEvent } from "@/lib/email/contracts";

// The existing helper rejects the primary DB before this file loads. Auth,
// Inngest, and all HTTP are mocked; only the disposable database is real.
type TestUser = { id: string; email: string; email_confirmed_at: string | null; user_metadata: Record<string, unknown>; app_metadata: Record<string, unknown>; banned_until?: string };
const users = new Map<string, TestUser>();
let viewer: TestUser | null = null;
let wakeFails = false;
let wakeCalls = 0;
let lookupFails = false;
let lookupFailUserId: string | null = null;
let fetched: RequestInit[] = [];
let response: () => Promise<Response>;
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: viewer }, error: null }) } }),
  createAdminClient: async () => ({ auth: { admin: {
    getUserById: async (id: string) => ({ data: { user: users.get(id) ?? null }, error: lookupFails || id === lookupFailUserId ? { status: 503 } : null }),
    updateUserById: async (id: string, payload: Partial<TestUser>) => { Object.assign(users.get(id)!, payload); return { error: null }; },
  } } }),
});
moduleStubs.set("next/headers", { headers: async () => new Headers({ "user-agent": "email-test" }), cookies: async () => ({ get: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn });
moduleStubs.set("@/lib/security/rate-limit", { consumeRateLimit: async () => ({ allowed: true }) });
moduleStubs.set("@/app/api/v1/_shared", {
  enforceRouteLimit: async () => null,
  requireAuthenticatedUser: async () => ({ supabase: null, user: viewer, extensionSessionId: null, response: null }),
});
moduleStubs.set("@/inngest/client", { inngest: { send: async () => { wakeCalls++; if (wakeFails) throw new Error("Inngest unavailable"); return { ids: [] }; } } });

let db: typeof import("@/lib/db").db;
let outbox: typeof import("@/lib/email/outbox");
let delivery: typeof import("@/lib/email/delivery");
let onboarding: typeof import("@/app/actions/onboarding");
let taskActions: typeof import("@/app/actions/task");
let projectActions: typeof import("@/app/actions/workspace");
let webhook: typeof import("@/app/api/v1/webhooks/resend/route");
before(async () => {
  (process.env as Record<string, string>).NODE_ENV = "test";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.APP_URL = "http://localhost:3000";
  db = (await loadAppModule(() => import("@/lib/db"))).db;
  outbox = await import("@/lib/email/outbox");
  delivery = await import("@/lib/email/delivery");
  onboarding = await import("@/app/actions/onboarding");
  taskActions = await import("@/app/actions/task");
  projectActions = await import("@/app/actions/workspace");
  webhook = await import("@/app/api/v1/webhooks/resend/route");
  // drainEmailOutbox is the global worker (25 rows a run, oldest first). Other test files queue mail too
  // (.env.local enables sending), so start from an empty queue or their rows use up the budget.
  await sql`DELETE FROM email_outbox WHERE status IN ('pending', 'processing')`;
});
beforeEach(() => {
  process.env.RESEND_EMAIL_ENABLED = "true";
  process.env.INNGEST_EXECUTION_ROLE = "worker";
  process.env.RESEND_API_KEY = "test-only-not-a-live-key";
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from("isolated-svix-test-key").toString("base64")}`;
  process.env.RESEND_TEST_RECIPIENTS = "";
  fetched = []; wakeCalls = 0; wakeFails = false; lookupFails = false; lookupFailUserId = null;
  response = async () => Response.json({ id: randomUUID() });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails", "no unexpected/live HTTP in a database test");
    fetched.push(init!);
    return response();
  };
});
afterEach(async () => {
  const ids = [...users.keys()];
  if (ids.length) await sql`DELETE FROM auth.users WHERE id IN ${sql(ids)}`;
  await sql`DELETE FROM public.email_webhook_events`;
  await sql`DELETE FROM public.email_suppressions`;
  users.clear(); viewer = null;
  globalThis.fetch = originalFetch;
});
after(async () => { process.env = originalEnv; await sql.end(); await closeAppDb(); });

async function user() {
  const id = await sql.begin((tx) => createUser(tx));
  const [row] = await sql`SELECT email FROM auth.users WHERE id = ${id}`;
  const u: TestUser = { id, email: row!.email, email_confirmed_at: new Date().toISOString(), user_metadata: {}, app_metadata: {} };
  users.set(id, u);
  process.env.RESEND_TEST_RECIPIENTS = [...users.values()].map((u) => u.email).join(",");
  return u;
}
async function welcome(u: TestUser) {
  await db.transaction(async (tx) => {
    await tx.update(profiles).set({ onboardingStatus: "completed" }).where(eq(profiles.id, u.id));
    await outbox.queueEmail(tx, { kind: "welcome", eventId: u.id, userId: u.id });
  });
}
async function queueRow(userId: string) {
  const [row] = await sql`SELECT * FROM public.email_outbox WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1`;
  assert.ok(row);
  return row;
}
async function assignedTask() {
  const owner = await user(); const a = await user(); const b = await user(); viewer = owner;
  const projectId = await sql.begin(async (tx) => {
    const id = await createProject(tx, owner.id);
    await addMember(tx, id, owner.id, "owner"); await addMember(tx, id, a.id); await addMember(tx, id, b.id);
    await tx`INSERT INTO project_workflow_columns (project_id, title, status, is_default, position, accent_class_name, empty_title, empty_description)
      VALUES (${id}, 'Todo', 'todo', true, 0, 'neutral', 'No tasks', 'No tasks yet') ON CONFLICT DO NOTHING`;
    return id;
  });
  const result = await projectActions.createTaskAction({ projectId, title: "Ship this task", description: "NEVER_IN_EMAIL", assigneeId: a.id, status: "todo", priority: "medium" });
  assert.equal(result.success, true, result.error);
  assert.ok(result.task?.id);
  return { owner, a, b, projectId, taskId: result.task.id };
}

test("final onboarding saves the provider avatar/profile and queues exactly once under concurrent submits/replays", async () => {
  const u = await user(); viewer = u; u.user_metadata.avatar_url = "https://example.test/avatar.png";
  const payload = { username: `mail_${u.id.slice(0, 8)}`, fullName: "Mail User", skills: [], visibility: "public" as const, idempotencyKey: randomUUID() };
  const results = await Promise.all([onboarding.completeOnboarding(payload), onboarding.completeOnboarding(payload)]);
  assert.ok(results.some((result) => result.success));
  assert.equal((await onboarding.completeOnboarding(payload)).success, true);
  assert.equal((await onboarding.completeOnboarding({ ...payload, idempotencyKey: randomUUID() })).success, true);
  const [saved] = await sql`SELECT username, avatar_url, onboarding_status FROM profiles WHERE id = ${u.id}`;
  assert.equal(saved!.username, payload.username);
  assert.equal(saved!.avatar_url, u.user_metadata.avatar_url);
  assert.equal(saved!.onboarding_status, "completed");
  const [count] = await sql`SELECT count(*)::int AS n FROM email_outbox WHERE user_id = ${u.id}`;
  assert.equal(count!.n, 1); assert.equal(fetched.length, 0, "the action never sends provider mail");
});

test("email queue and onboarding changes roll back together on a persistence failure", async () => {
  const u = await user();
  await assert.rejects(db.transaction(async (tx) => {
    await tx.update(profiles).set({ onboardingStatus: "completed", avatarUrl: "https://example.test/new.png" }).where(eq(profiles.id, u.id));
    await outbox.queueEmail(tx, { kind: "welcome", eventId: u.id, userId: u.id });
    throw new Error("forced rollback");
  }), /forced rollback/);
  const [state] = await sql`SELECT onboarding_status, avatar_url, (SELECT count(*)::int FROM email_outbox WHERE user_id = ${u.id}) AS emails FROM profiles WHERE id = ${u.id}`;
  assert.notEqual(state!.onboarding_status, "completed"); assert.equal(state!.avatar_url, null); assert.equal(state!.emails, 0);
});

test("intermediate Continue persists a draft without queuing welcome mail", async () => {
  const u = await user(); viewer = u;
  const result = await onboarding.commitOnboardingStep({ step: 1, expectedVersion: 0,
    draft: { username: `mail_${u.id.slice(0, 8)}`, fullName: "Draft User" } });
  assert.equal(result.success, true, result.error);
  assert.equal((await sql`SELECT id FROM email_outbox WHERE user_id = ${u.id}`).length, 0);
  assert.equal(fetched.length, 0); assert.equal(wakeCalls, 0);
});

test("queue creation is disabled by default and concurrent event insertion dedupes", async () => {
  const u = await user(); delete process.env.RESEND_EMAIL_ENABLED;
  await welcome(u);
  assert.equal((await sql`SELECT id FROM email_outbox WHERE user_id = ${u.id}`).length, 0);
  process.env.RESEND_EMAIL_ENABLED = "true";
  await Promise.all(Array.from({ length: 6 }, () => db.transaction((tx) => outbox.queueEmail(tx, { kind: "welcome", eventId: u.id, userId: u.id }))));
  assert.equal((await sql`SELECT id FROM email_outbox WHERE user_id = ${u.id}`).length, 1);
});

test("disabled sending preserves queued work; concurrent workers claim it only once", async () => {
  const u = await user(); await welcome(u);
  process.env.RESEND_EMAIL_ENABLED = "false";
  assert.deepEqual(await delivery.drainEmailOutbox(), { processed: 0 });
  assert.equal(fetched.length, 0); assert.equal((await queueRow(u.id)).status, "pending");
  process.env.RESEND_EMAIL_ENABLED = "true";
  await Promise.all([delivery.drainEmailOutbox(), delivery.drainEmailOutbox()]);
  assert.equal(fetched.length, 1); assert.equal((await queueRow(u.id)).status, "accepted");
});

test("creation and A→B→A create new in-app notifications/emails; unchanged, self, edits and unassignment do not", async () => {
  const { owner, a, b, projectId, taskId } = await assignedTask();
  await delivery.drainEmailOutbox();
  assert.equal(fetched.length, 1); assert.doesNotMatch(String(fetched[0]!.body), /NEVER_IN_EMAIL/);
  for (const assignee of [b.id, a.id]) {
    assert.equal((await taskActions.assignTaskAction(taskId, assignee, projectId)).success, true);
    await delivery.drainEmailOutbox();
  }
  assert.equal(fetched.length, 3);
  const notifications = await sql`SELECT dedupe_key FROM user_notifications WHERE user_id = ${a.id} AND kind = 'task_assigned'`;
  assert.equal(notifications.length, 2); assert.equal(new Set(notifications.map((n) => n.dedupe_key)).size, 2);
  assert.equal((await taskActions.assignTaskAction(taskId, a.id, projectId)).success, true);
  assert.equal((await taskActions.updateTaskFieldAction(taskId, "title", "Edited title", projectId)).success, true);
  assert.equal((await taskActions.assignTaskAction(taskId, null, projectId)).success, true);
  assert.equal((await taskActions.assignTaskAction(taskId, owner.id, projectId)).success, true);
  await delivery.drainEmailOutbox(); assert.equal(fetched.length, 3);
});

test("an obsolete first A assignment is suppressed if A→B→A occurs before delivery", async () => {
  const { a, b, projectId, taskId } = await assignedTask();
  assert.equal((await taskActions.assignTaskAction(taskId, b.id, projectId)).success, true);
  assert.equal((await taskActions.assignTaskAction(taskId, a.id, projectId)).success, true);
  await delivery.drainEmailOutbox(); assert.equal(fetched.length, 1);
  assert.match(String(fetched[0]!.body), new RegExp(a.email));
  const rows = await sql`SELECT status FROM email_outbox WHERE task_id = ${taskId}`;
  assert.equal(rows.filter((r) => r.status === "accepted").length, 1);
});

test("soft-deleted tasks are dropped before first delivery and before retry of a frozen payload", async () => {
  const { a, taskId } = await assignedTask();
  await sql`UPDATE tasks SET deleted_at = now() WHERE id = ${taskId}`;
  await delivery.drainEmailOutbox();
  assert.equal(fetched.length, 0);
  assert.equal((await queueRow(a.id)).status, "dropped");
  await sql`UPDATE tasks SET deleted_at = NULL WHERE id = ${taskId}`;
  await sql`UPDATE email_outbox SET status = 'pending', due_at = now() WHERE task_id = ${taskId}`;
  response = async () => new Response(null, { status: 503 });
  await delivery.drainEmailOutbox();
  assert.equal(fetched.length, 1);
  assert.ok((await queueRow(a.id)).payload);
  await sql`UPDATE tasks SET deleted_at = now() WHERE id = ${taskId}`;
  await sql`UPDATE email_outbox SET due_at = now() WHERE task_id = ${taskId}`;
  await delivery.drainEmailOutbox();
  assert.equal(fetched.length, 1);
  assert.equal((await queueRow(a.id)).last_error, "assignment_or_access_changed");
  assert.equal((await queueRow(a.id)).attempts, 1);
});

test("collaborator removal reassigns only active tasks with fresh activities, notifications and emails", async () => {
  const { owner, a, b, projectId, taskId } = await assignedTask();
  for (const title of ["Second active task", "Completed task", "Deleted task"]) {
    const result = await projectActions.createTaskAction({ projectId, title, assigneeId: a.id, status: "todo", priority: "medium" });
    assert.equal(result.success, true, result.error);
    if (title === "Completed task") await sql`UPDATE tasks SET status = 'done' WHERE id = ${result.task!.id}`;
    if (title === "Deleted task") await sql`UPDATE tasks SET deleted_at = now() WHERE id = ${result.task!.id}`;
  }
  const wakeBefore = wakeCalls;
  const removed = await projectActions.removeProjectMemberAction(projectId, a.id, { mode: "reassign_active_tasks", reassignToUserId: b.id });
  assert.equal(removed.success, true, removed.message);
  assert.ok(wakeCalls > wakeBefore);
  const activities = await sql`SELECT id, payload FROM task_activity_events WHERE project_id = ${projectId} AND event_type = 'assigned' AND payload->>'assigneeId' = ${b.id}`;
  assert.equal(activities.length, 2);
  assert.ok(activities.every((event) => event.payload.previousAssigneeId === a.id && event.payload.actorName));
  const notifications = await sql`SELECT dedupe_key FROM user_notifications WHERE user_id = ${b.id} AND kind = 'task_assigned'`;
  assert.equal(notifications.length, 2);
  for (const activity of activities) assert.ok(notifications.some((row) => row.dedupe_key.includes(activity.id)));
  assert.equal((await sql`SELECT id FROM email_outbox WHERE user_id = ${b.id}`).length, 2);
  await delivery.drainEmailOutbox();
  assert.equal(fetched.length, 2);
  assert.ok(fetched.every((request) => String(request.body).includes(b.email)));
  const untouched = await sql`SELECT title, assignee_id FROM tasks WHERE project_id = ${projectId} AND (status = 'done' OR deleted_at IS NOT NULL)`;
  assert.equal(untouched.length, 2);
  assert.ok(untouched.every((task) => task.assignee_id === a.id));
  // Rejoining and assigning back must not reuse the original A notification key.
  await sql.begin((tx) => addMember(tx, projectId, a.id));
  assert.equal((await taskActions.assignTaskAction(taskId, a.id, projectId)).success, true);
  await delivery.drainEmailOutbox();
  assert.equal(fetched.length, 3);
  const returned = await sql`SELECT dedupe_key FROM user_notifications WHERE user_id = ${a.id} AND kind = 'task_assigned' AND entity_refs->>'taskId' = ${taskId}`;
  assert.equal(returned.length, 2);
  assert.equal(new Set(returned.map((row) => row.dedupe_key)).size, 2);
  assert.equal(viewer?.id, owner.id);
});

test("bulk reassignment preserves self-assignment exclusion and email opt-out", async () => {
  const { owner, a, b, projectId, taskId } = await assignedTask();
  const self = await projectActions.removeProjectMemberAction(projectId, a.id, { mode: "reassign_active_tasks", reassignToUserId: owner.id });
  assert.equal(self.success, true, self.message);
  assert.equal((await sql`SELECT id FROM email_outbox WHERE user_id = ${owner.id}`).length, 0);
  assert.equal((await sql`SELECT id FROM user_notifications WHERE user_id = ${owner.id} AND kind = 'task_assigned'`).length, 0);
  assert.equal((await sql`SELECT id FROM task_activity_events WHERE task_id = ${taskId} AND event_type = 'assigned' AND payload->>'assigneeId' = ${owner.id}`).length, 1);
  await sql.begin((tx) => addMember(tx, projectId, a.id));
  assert.equal((await taskActions.assignTaskAction(taskId, a.id, projectId)).success, true);
  await sql`UPDATE profiles SET notification_preferences = '{"delivery":{"email":false}}' WHERE id = ${b.id}`;
  const optedOut = await projectActions.removeProjectMemberAction(projectId, a.id, { mode: "reassign_active_tasks", reassignToUserId: b.id });
  assert.equal(optedOut.success, true, optedOut.message);
  await delivery.drainEmailOutbox();
  assert.equal(fetched.length, 0);
  assert.equal((await queueRow(b.id)).last_error, "email_opt_out");
});

test("bulk reassignment rolls back assignment, activity, membership removal and queued mail together", async () => {
  const { owner, a, b, projectId, taskId } = await assignedTask();
  const { removeProjectMemberInternal } = await import("@/lib/workspaces/collaborator-lifecycle");
  await assert.rejects(db.transaction(async (tx) => {
    await removeProjectMemberInternal(tx, { projectId, actorId: owner.id, targetUserId: a.id, mode: "reassign_active_tasks", reassignToUserId: b.id });
    throw new Error("forced rollback after removal");
  }), /forced rollback/);
  assert.equal((await sql`SELECT assignee_id FROM tasks WHERE id = ${taskId}`)[0]!.assignee_id, a.id);
  assert.equal((await sql`SELECT id FROM task_activity_events WHERE task_id = ${taskId} AND event_type = 'assigned' AND payload->>'assigneeId' = ${b.id}`).length, 0);
  assert.equal((await sql`SELECT id FROM project_members WHERE project_id = ${projectId} AND user_id = ${a.id}`).length, 1);
  assert.equal((await sql`SELECT id FROM email_outbox WHERE user_id = ${b.id}`).length, 0);
  await sql`UPDATE project_members SET role = 'viewer' WHERE project_id = ${projectId} AND user_id = ${b.id}`;
  const invalid = await projectActions.removeProjectMemberAction(projectId, a.id, { mode: "reassign_active_tasks", reassignToUserId: b.id });
  assert.equal(invalid.success, false);
  assert.equal((await sql`SELECT assignee_id FROM tasks WHERE id = ${taskId}`)[0]!.assignee_id, a.id);
});

test("task preferences, category/mutes, pause/quiet hours and revoked access apply at send time", async () => {
  const { owner, a, projectId, taskId } = await assignedTask();
  const reset = async (preferences: object) => {
    await sql`UPDATE profiles SET notification_preferences = ${sql.json(preferences)} WHERE id = ${a.id}`;
    await sql`UPDATE email_outbox SET status = 'pending', due_at = now(), last_error = NULL WHERE task_id = ${taskId}`;
  };
  for (const [prefs, reason] of [
    [{ delivery: { email: false } }, "email_opt_out"], [{ tasks: false }, "category_off"],
    [{ mutedScopes: [{ kind: "task", value: taskId }] }, "muted_scope"],
    [{ mutedScopes: [{ kind: "project", value: projectId }] }, "muted_scope"],
    [{ mutedScopes: [{ kind: "person", value: owner.id }] }, "muted_scope"],
  ] as const) {
    await reset(prefs); await delivery.drainEmailOutbox(); assert.equal((await queueRow(a.id)).last_error, reason);
  }
  await reset({ pausedUntil: new Date(Date.now() + 3_600_000).toISOString() });
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(a.id)).status, "pending");
  assert.ok(new Date((await queueRow(a.id)).due_at).getTime() > Date.now());
  const minute = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  await reset({ quietHours: { enabled: true, startMinute: (minute + 1439) % 1440, endMinute: (minute + 60) % 1440, timeZone: "UTC" } });
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(a.id)).status, "pending");
  assert.equal((await queueRow(a.id)).attempts, 0);
  await reset({}); await sql`UPDATE project_members SET role = 'viewer' WHERE project_id = ${projectId} AND user_id = ${a.id}`;
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(a.id)).last_error, "assignment_or_access_changed");
  await reset({}); await sql`DELETE FROM project_members WHERE project_id = ${projectId} AND user_id = ${a.id}`;
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(a.id)).last_error, "assignment_or_access_changed");
  assert.equal(fetched.length, 0);
});

test("welcome is independent of task preferences; recipients must be verified, active and explicitly allowlisted", async () => {
  const u = await user(); await welcome(u);
  u.email_confirmed_at = null;
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(u.id)).last_error, "recipient_unverified_or_inactive");
  u.email_confirmed_at = new Date().toISOString();
  const reset = () => sql`UPDATE email_outbox SET status = 'pending', due_at = now() WHERE user_id = ${u.id}`;
  await reset(); process.env.RESEND_TEST_RECIPIENTS = "";
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(u.id)).last_error, "nonproduction_recipient_not_allowlisted");
  process.env.RESEND_TEST_RECIPIENTS = u.email;
  await reset(); await sql`UPDATE profiles SET deleted_at = now() WHERE id = ${u.id}`;
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(u.id)).last_error, "account_inactive");
  await reset(); await sql`UPDATE profiles SET deleted_at = NULL, notification_preferences = '{"tasks":false,"delivery":{"email":false}}' WHERE id = ${u.id}`;
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(u.id)).status, "accepted"); assert.equal(fetched.length, 1);
});

test("rate limits, timeouts, expired leases and missed wakeups recover with frozen payload/idempotency", async () => {
  const u = await user(); await welcome(u);
  wakeFails = true; await outbox.wakeEmailWorker(); assert.equal(wakeCalls, 1);
  response = async () => new Response(null, { status: 429, headers: { "retry-after": "120" } });
  await delivery.drainEmailOutbox(); const first = await queueRow(u.id);
  assert.equal(first.status, "pending"); assert.equal(first.attempts, 1);
  assert.ok(new Date(first.due_at).getTime() >= Date.now() + 115_000);
  await sql`UPDATE profiles SET full_name = 'Changed after first attempt' WHERE id = ${u.id}`;
  await sql`UPDATE email_outbox SET status = 'processing', lease_id = ${randomUUID()}, lease_expires_at = now() - interval '1 minute' WHERE user_id = ${u.id}`;
  response = async () => { throw new DOMException("Timed out", "TimeoutError"); };
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(u.id)).attempts, 2);
  assert.equal(fetched[0]!.body, fetched[1]!.body);
  assert.equal(new Headers(fetched[0]!.headers).get("idempotency-key"), new Headers(fetched[1]!.headers).get("idempotency-key"));
  await sql`UPDATE email_outbox SET due_at = now() WHERE user_id = ${u.id}`;
  response = async () => Response.json({ id: randomUUID() });
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(u.id)).status, "accepted");
  assert.equal(fetched[0]!.body, fetched[2]!.body); assert.ok(fetched[0]!.signal);
});

test("expired ambiguous requests/attempt limits flag review; permanent failures stop and lookup failures wait", async () => {
  const u = await user(); await welcome(u); lookupFails = true;
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(u.id)).status, "pending"); assert.equal((await queueRow(u.id)).attempts, 0);
  lookupFails = false;
  await sql`UPDATE email_outbox SET due_at = now(), first_attempt_at = ${new Date(Date.now() - RETRY_WINDOW_MS)} WHERE user_id = ${u.id}`;
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(u.id)).status, "needs_review"); assert.equal(fetched.length, 0);
  await sql`UPDATE email_outbox SET status = 'processing', lease_expires_at = now() - interval '1 minute', first_attempt_at = now(), attempts = ${MAX_ATTEMPTS} WHERE user_id = ${u.id}`;
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(u.id)).last_error, "attempt_limit_exhausted"); assert.equal(fetched.length, 0);
  await sql`UPDATE email_outbox SET status = 'pending', attempts = 0, due_at = now(), first_attempt_at = NULL WHERE user_id = ${u.id}`;
  response = async () => new Response(null, { status: 422 });
  await delivery.drainEmailOutbox(); assert.equal((await queueRow(u.id)).status, "failed");
});

test("a failed recipient lookup releases its lease and does not block other queued deliveries", async () => {
  const unavailable = await user(); const healthy = await user();
  await welcome(unavailable); await welcome(healthy);
  lookupFailUserId = unavailable.id;
  await delivery.drainEmailOutbox();
  const pending = await queueRow(unavailable.id);
  assert.equal(pending.status, "pending");
  assert.equal(pending.attempts, 0);
  assert.equal(pending.lease_id, null);
  assert.equal(pending.lease_expires_at, null);
  assert.equal(pending.last_error, "recipient_lookup_unavailable");
  assert.ok(new Date(pending.due_at).getTime() > Date.now());
  assert.equal((await queueRow(healthy.id)).status, "accepted");
  assert.equal(fetched.length, 1);
  assert.match(String(fetched[0]!.body), new RegExp(healthy.email));
});

test("duplicate/out-of-order/early receipts reconcile durably; hard bounces suppress subsequent emails", async () => {
  const u = await user(); const providerId = randomUUID(); await welcome(u);
  const event: ResendEvent = { type: "email.delivered", created_at: new Date().toISOString(), data: { email_id: providerId, to: [u.email] } };
  await delivery.recordResendEvent("msg_early", event);
  response = async () => Response.json({ id: providerId }); await delivery.drainEmailOutbox();
  assert.equal((await queueRow(u.id)).delivery_state, "delivered");
  await delivery.recordResendEvent("msg_early", event);
  await delivery.recordResendEvent("msg_late_sent", { ...event, type: "email.sent" });
  assert.equal((await queueRow(u.id)).delivery_state, "delivered");
  assert.equal((await sql`SELECT id FROM email_webhook_events WHERE id = 'msg_early'`).length, 1);
  await delivery.recordResendEvent("msg_bounce", { ...event, type: "email.bounced", data: { ...event.data, bounce: { type: "Permanent" } } });
  await delivery.recordResendEvent("msg_complaint", { ...event, type: "email.complained" });
  await delivery.recordResendEvent("msg_delivered_late", event);
  assert.equal((await queueRow(u.id)).delivery_state, "complained");
  await db.transaction((tx) => outbox.queueEmail(tx, { kind: "welcome", eventId: randomUUID(), userId: u.id }));
  await delivery.drainEmailOutbox(); assert.equal(fetched.length, 1);
  assert.equal((await queueRow(u.id)).last_error, "suppressed");
});

test("signed webhook route rejects invalid signatures and records before success acknowledgement", async () => {
  const event: ResendEvent = { type: "email.complained", created_at: new Date().toISOString(), data: { email_id: randomUUID(), to: ["suppressed@test.local"] } };
  const raw = JSON.stringify(event); const date = new Date(); const id = "msg_route";
  const headers = { "svix-id": id, "svix-timestamp": String(Math.floor(date.getTime() / 1000)), "svix-signature": new Webhook(process.env.RESEND_WEBHOOK_SECRET!).sign(id, date, raw) };
  const request = (signature = headers["svix-signature"]) => new NextRequest("http://localhost/api/v1/webhooks/resend", { method: "POST", headers: { ...headers, "svix-signature": signature }, body: raw });
  assert.equal((await webhook.POST(request("v1,bad"))).status, 401);
  assert.equal((await sql`SELECT id FROM email_webhook_events WHERE id = ${id}`).length, 0);
  assert.equal((await webhook.POST(request())).status, 200);
  assert.equal((await sql`SELECT id FROM email_webhook_events WHERE id = ${id}`).length, 1);
  assert.equal((await webhook.POST(request())).status, 200);
  assert.equal((await sql`SELECT email FROM email_suppressions WHERE email = 'suppressed@test.local'`).length, 1);
});

test("sending cannot run on the web service and private mail tables have no browser grants", async () => {
  process.env.INNGEST_EXECUTION_ROLE = "web";
  await assert.rejects(delivery.drainEmailOutbox(), /must run on the worker/);
  const rows = await sql`SELECT table_name FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name IN ('email_outbox','email_webhook_events','email_suppressions') AND grantee IN ('anon','authenticated','PUBLIC')`;
  assert.equal(rows.length, 0);
});
