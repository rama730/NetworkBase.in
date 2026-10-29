/**
 * Disposable-database test helpers. Every test runs inside a transaction that
 * is always rolled back, so fixtures never persist. Build the database with
 *   export DATABASE_URL_FRESH=$(npm run -s db:disposable)
 */
import { randomUUID } from "node:crypto";
import Module from "node:module";

import dotenv from "dotenv";
import postgres from "postgres";

import { requireDisposableDatabaseUrl } from "../../scripts/lib/disposable-db";

dotenv.config({ path: ".env.local", quiet: true });

// Tests never reach a real Redis. Under NODE_ENV=test the rate limiter keeps its own in-memory limits;
// without this CI (no Redis, production-like fail-closed mode) rejects every rate-limited action.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
(process.env as Record<string, string>).NODE_ENV = "test";

// App modules import "server-only"; outside Next's react-server build it is a no-op.
type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const moduleWithLoad = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoad._load;
export const moduleStubs = new Map<string, unknown>([["server-only", {}]]);
moduleWithLoad._load = (request, parent, isMain) => (moduleStubs.has(request) ? moduleStubs.get(request) : originalLoad(request, parent, isMain));

/** Post-response work (next/server after) runs inline; the action returns before it settles, as in a request. */
export function stubNextAfter() {
  moduleStubs.set("next/server", {
    after: (task: unknown) => { void Promise.resolve(typeof task === "function" ? (task as () => unknown)() : task).catch(() => undefined); },
    NextResponse: class {}, NextRequest: class {},
  });
}

const DISPOSABLE_URL = requireDisposableDatabaseUrl("test:db");
export const sql = postgres(DISPOSABLE_URL, { max: 4, prepare: false, onnotice: () => undefined });
export type Tx = postgres.TransactionSql;

const ROLLBACK = Symbol("rollback");

/** Runs fn in a transaction that is always rolled back; returns fn's result. */
export async function inRollback<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await sql.begin(async (tx) => {
      result = await fn(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result as T;
}

/** Switches the transaction to a PostgREST-like caller. `userId` null = anon. */
export async function actAs(tx: Tx, userId: string | null) {
  await tx.unsafe(`SET LOCAL ROLE ${userId ? "authenticated" : "anon"}`);
  const claims = JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" });
  await tx`SELECT set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${userId ?? ""}, true)`;
}

/**
 * Most tables are not browser-readable at all (0199). Policy tests still pin the
 * row rules on them as a second layer by granting SELECT inside the rolled-back
 * transaction.
 */
export async function grantBrowserRead(tx: Tx, tables: string[]) {
  await tx.unsafe(`GRANT SELECT ON ${tables.map((t) => `public.${t}`).join(", ")} TO anon, authenticated`);
}

/** Back to the owner role (bypasses RLS) for setup or assertions. */
export async function actAsOwner(tx: Tx) {
  await tx.unsafe("RESET ROLE");
  await tx`SELECT set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true)`;
}

export async function createUser(tx: Tx, overrides: { visibility?: string } = {}) {
  const id = randomUUID();
  const handle = `u${id.slice(0, 8)}`;
  await tx`INSERT INTO auth.users (id, email) VALUES (${id}, ${`${handle}@test.local`})`;
  await tx`INSERT INTO public.profiles (id, email, username, full_name, visibility)
           VALUES (${id}, ${`${handle}@test.local`}, ${handle}, ${handle}, ${overrides.visibility ?? "public"})`;
  return id;
}

const DEFAULT_TABS = { dashboard: true, readme: true, updates: true, files: true, tasks: false, sprints: false };

export async function createProject(
  tx: Tx,
  ownerId: string,
  options: { visibility?: string; status?: string; publicTabVisibility?: Record<string, boolean> } = {},
) {
  const id = randomUUID();
  await tx`INSERT INTO public.workspaces (id, owner_id, title, slug, visibility, status, public_tab_visibility)
           VALUES (${id}, ${ownerId}, ${`Project ${id.slice(0, 6)}`}, ${`p-${id}`}, ${options.visibility ?? "public"},
                   ${options.status ?? "active"}, ${tx.json({ ...DEFAULT_TABS, ...options.publicTabVisibility })})`;
  return id;
}

export async function addMember(tx: Tx, projectId: string, userId: string, role = "member") {
  await tx`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (${projectId}, ${userId}, ${role})`;
}

/** Owner + member + outsider around one project. */
export async function projectWithPeople(tx: Tx, options: Parameters<typeof createProject>[2] = {}) {
  const owner = await createUser(tx);
  const member = await createUser(tx);
  const outsider = await createUser(tx);
  const projectId = await createProject(tx, owner, options);
  await addMember(tx, projectId, member);
  return { owner, member, outsider, projectId };
}

// NB_TEST_APP_ROLE=nb_app runs app code as the production runtime role (0268); fixtures stay on postgres.
const APP_ROLE = process.env.NB_TEST_APP_ROLE?.trim();
let appRoleReady: Promise<unknown> | undefined;
async function appDatabaseUrl() {
  if (!APP_ROLE) return DISPOSABLE_URL;
  if (!/^[a-z_][a-z0-9_]*$/.test(APP_ROLE)) throw new Error("NB_TEST_APP_ROLE must be a plain role name");
  await (appRoleReady ??= sql.unsafe(`ALTER ROLE ${APP_ROLE} LOGIN`));
  const url = new URL(DISPOSABLE_URL);
  url.username = APP_ROLE;
  url.password = "";
  return url.toString();
}

/**
 * Loads app modules (which import "@/lib/db") bound to the disposable
 * database. Call inside a test or hook; returns the dynamic import.
 */
export async function loadAppModule<T>(load: () => Promise<T>): Promise<T> {
  process.env.DATABASE_URL = await appDatabaseUrl();
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
  return load();
}

/** Closes the app's shared postgres.js client (src/lib/db keeps it on globalThis). */
export async function closeAppDb() {
  await (globalThis as { conn?: { end: () => Promise<void> } }).conn?.end();
}
