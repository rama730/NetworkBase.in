import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { closeAppDb, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Real database, mocked auth. Pins what the onboarding actions guarantee about the data they leave behind.
type TestUser = { id: string; email: string; email_confirmed_at: string | null; user_metadata: Record<string, unknown>; app_metadata: Record<string, unknown> };
const users = new Map<string, TestUser>();
let viewer: TestUser | null = null;
moduleStubs.set("@/lib/supabase/server", {
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: viewer }, error: null }) } }),
  createAdminClient: async () => ({ auth: { admin: { updateUserById: async () => ({ error: null }) } } }),
});
moduleStubs.set("next/headers", { headers: async () => new Headers({ "user-agent": "onboarding-test" }), cookies: async () => ({ get: () => undefined }) });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn });
moduleStubs.set("@/lib/security/rate-limit", { consumeRateLimit: async () => ({ allowed: true }) });
moduleStubs.set("@/inngest/client", { inngest: { send: async () => ({ ids: [] }) } });

let onboarding: typeof import("@/app/actions/onboarding");
before(async () => {
  (process.env as Record<string, string>).NODE_ENV = "test";
  process.env.RESEND_EMAIL_ENABLED = "true";
  await loadAppModule(() => import("@/lib/db"));
  onboarding = await import("@/app/actions/onboarding");
});
beforeEach(() => { viewer = null; });
afterEach(async () => {
  const ids = [...users.keys()];
  if (ids.length) {
    await sql`DELETE FROM username_aliases WHERE user_id IN ${sql(ids)}`;
    await sql`DELETE FROM auth.users WHERE id IN ${sql(ids)}`;
  }
  users.clear();
});
after(async () => { await sql.end(); await closeAppDb(); });

async function person() {
  const id = await sql.begin((tx) => createUser(tx));
  const [row] = await sql`SELECT email FROM auth.users WHERE id = ${id}`;
  const u: TestUser = { id, email: row!.email, email_confirmed_at: new Date().toISOString(), user_metadata: {}, app_metadata: {} };
  users.set(id, u);
  return u;
}
const name = () => `t${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const settle = () => new Promise((resolve) => setTimeout(resolve, 150)); // follow-up work runs after the response
const payload = (username: string, extra: Record<string, unknown> = {}) => ({ username, fullName: "Test Person", skills: ["React"], visibility: "public" as const, ...extra });

test("a failed attempt does not lock the person out: a different username goes through", async () => {
  const owner = await person();
  const taken = name();
  await sql`INSERT INTO username_aliases (username, user_id, is_primary) VALUES (${taken}, ${owner.id}, true)`;
  const u = await person(); viewer = u;

  const first = await onboarding.completeOnboarding(payload(taken));
  assert.equal(first.success, false);
  assert.equal(first.errorDetails?.code, "USERNAME_TAKEN");

  const second = await onboarding.completeOnboarding(payload(name()));
  assert.equal(second.success, true, second.error);
  await settle();
  const events = await sql`SELECT event_type FROM onboarding_events WHERE user_id = ${u.id}`;
  assert.deepEqual(events.map((e) => e.event_type).filter((t) => t.startsWith("submit_")).sort(), ["submit_error", "submit_start", "submit_start", "submit_success"], "the server records how each attempt ended");
});

test("a finished account cannot be rewritten through the onboarding action", async () => {
  const u = await person(); viewer = u;
  const username = name();
  assert.equal((await onboarding.completeOnboarding(payload(username, { headline: "First" }))).success, true);
  const [before] = await sql`SELECT username, full_name, headline, onboarding_completed_at FROM profiles WHERE id = ${u.id}`;

  const again = await onboarding.completeOnboarding(payload(name(), { fullName: "Someone Else", headline: "Changed", website: "https://evil.example.com" }));
  assert.equal(again.success, true, "idempotent, not an error");
  const [after] = await sql`SELECT username, full_name, headline, website, onboarding_completed_at FROM profiles WHERE id = ${u.id}`;
  assert.equal(after!.username, username);
  assert.equal(after!.full_name, before!.full_name);
  assert.equal(after!.headline, "First");
  assert.equal(after!.website, null);
  assert.equal(String(after!.onboarding_completed_at), String(before!.onboarding_completed_at));
  await settle();
  assert.equal((await sql`SELECT id FROM email_outbox WHERE user_id = ${u.id}`).length, 1, "one welcome email, however many submits");
});

test("claiming a username retires every other primary alias, leaving exactly one", async () => {
  const u = await person(); viewer = u;
  await sql`INSERT INTO username_aliases (username, user_id, is_primary) VALUES (${name()}, ${u.id}, true)`;
  const fresh = name();
  assert.equal((await onboarding.completeOnboarding(payload(fresh))).success, true);
  const aliases = await sql`SELECT username, is_primary FROM username_aliases WHERE user_id = ${u.id}`;
  assert.deepEqual(aliases.filter((a) => a.is_primary).map((a) => a.username), [fresh]);
  assert.equal(aliases.length, 2);
});

test("nothing is parsed or revealed for a caller who is not signed in", async () => {
  viewer = null;
  const result = await onboarding.completeOnboarding({ username: "!!", fullName: "" } as never);
  assert.equal(result.errorDetails?.code, "NOT_AUTHENTICATED");
  assert.deepEqual(await onboarding.getUsernameSuggestions("Ada Lovelace"), { suggestions: [] });
  const step = await onboarding.commitOnboardingStep({ step: 1, expectedVersion: 0, draft: {} });
  assert.equal(step.success, false);
});

test("steps are saved in order; a retry whose response was lost succeeds instead of conflicting", async () => {
  const u = await person(); viewer = u;
  const draft1 = { username: name(), fullName: "Ordered Person" };

  const first = await onboarding.commitOnboardingStep({ step: 1, expectedVersion: 0, draft: draft1 });
  assert.equal(first.success, true);
  const retry = await onboarding.commitOnboardingStep({ step: 1, expectedVersion: 0, draft: draft1 });
  assert.equal(retry.success, true, "same save arriving twice is not a conflict");
  assert.equal(retry.success && first.success && retry.version, first.version);

  const skipped = await onboarding.commitOnboardingStep({ step: 3, expectedVersion: 1, draft: { ...draft1, skills: ["React"] } });
  assert.equal(skipped.success, false);
  assert.equal(!skipped.success && skipped.errorDetails.code, "DRAFT_CONFLICT", "step 3 cannot be saved before step 2");

  const second = await onboarding.commitOnboardingStep({ step: 2, expectedVersion: 1, draft: draft1 });
  assert.equal(second.success, true);
  const [state] = await sql`SELECT onboarding_status FROM profiles WHERE id = ${u.id}`;
  assert.equal(state!.onboarding_status, "in_progress");
});

test("a name with a space or symbol is refused at step 1, not silently cleaned", async () => {
  const u = await person(); viewer = u;
  const result = await onboarding.commitOnboardingStep({ step: 1, expectedVersion: 0, draft: { username: "bad name!", fullName: "Valid Name" } });
  assert.equal(result.success, false);
  assert.equal(!result.success && result.errorDetails.code, "USERNAME_INVALID");
  const short = await onboarding.commitOnboardingStep({ step: 1, expectedVersion: 0, draft: { username: name(), fullName: "A" } });
  assert.match(!short.success ? short.error : "", /full name/i);
});

test("a photo that is not a safe web address is refused at completion", async () => {
  const u = await person(); viewer = u;
  const result = await onboarding.completeOnboarding(payload(name(), { avatarUrl: "data:image/svg+xml;base64,PHN2Zz4=" }));
  assert.equal(result.success, false);
  assert.equal(result.errorDetails?.code, "INVALID_INPUT");
});
