/**
 * One guard for every tool that writes to a database it does not own (checks,
 * fixtures, load runs, E2E). A URL string comparison is not enough: a pooler
 * URL and a direct URL reach the same Supabase project, so targets are
 * compared by database identity.
 */

const SUPABASE_DIRECT_HOST = /^db\.([a-z0-9]{20})\.supabase\.co$/i;
const SUPABASE_POOLER_USER = /^[^.]+\.([a-z0-9]{20})$/i;
const SUPABASE_API_HOST = /^([a-z0-9]{20})\.supabase\.co$/i;

/** `supabase:<ref>` for Supabase database/API URLs, otherwise `pg:host:port/db`. */
export function databaseIdentity(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const ref = host.match(SUPABASE_DIRECT_HOST)?.[1]
    ?? decodeURIComponent(parsed.username).match(SUPABASE_POOLER_USER)?.[1]
    ?? host.match(SUPABASE_API_HOST)?.[1];
  if (ref) return `supabase:${ref.toLowerCase()}`;
  const localHost = ["127.0.0.1", "::1", "[::1]"].includes(host) ? "localhost" : host;
  return `pg:${localHost}:${parsed.port || "5432"}/${parsed.pathname.replace(/^\//, "") || "postgres"}`;
}

/** TLS for every remote database; local disposable Postgres runs without it. */
export function databaseSsl(url: string | undefined): "require" | false {
  try {
    return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(new URL(url ?? "").hostname) ? false : "require";
  } catch {
    return "require";
  }
}

function identityOrNull(url: string | undefined) {
  if (!url?.trim()) return null;
  try { return databaseIdentity(url); } catch { return null; }
}

/** Identities of the deployed environment, as captured before any E2E rebinding. */
function primaryIdentities(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const database = env.E2E_PRIMARY_DATABASE_URL !== undefined ? env.E2E_PRIMARY_DATABASE_URL : env.DATABASE_URL;
  const supabase = env.E2E_PRIMARY_SUPABASE_URL !== undefined ? env.E2E_PRIMARY_SUPABASE_URL : env.NEXT_PUBLIC_SUPABASE_URL;
  return new Set([identityOrNull(database), identityOrNull(supabase)].filter((id): id is string => Boolean(id)));
}

export function assertDisposableDatabaseUrl(url: string, label: string, env: NodeJS.ProcessEnv = process.env) {
  const identity = databaseIdentity(url);
  if (primaryIdentities(env).has(identity)) {
    throw new Error(`${label}: refusing to run against the primary database (${identity}). Use a disposable database.`);
  }
  return url;
}

/** The disposable target from E2E_DATABASE_URL / DATABASE_URL_FRESH / DATABASE_URL_REPLAY_FRESH. */
export function requireDisposableDatabaseUrl(label: string, env: NodeJS.ProcessEnv = process.env): string {
  const url = env.E2E_DATABASE_URL?.trim() || env.DATABASE_URL_FRESH?.trim() || env.DATABASE_URL_REPLAY_FRESH?.trim();
  if (!url) {
    throw new Error(`${label} requires E2E_DATABASE_URL, DATABASE_URL_FRESH or DATABASE_URL_REPLAY_FRESH. The primary database is never used.`);
  }
  return assertDisposableDatabaseUrl(url, label, env);
}

/**
 * Points the app, Auth/storage and admin clients at the disposable E2E
 * environment, recording the primary identities first so later isolation
 * checks still see them (OPS-003). Idempotent across processes.
 */
export function bindE2EEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const database = env.E2E_DATABASE_URL?.trim();
  if (database) {
    if (env.E2E_PRIMARY_DATABASE_URL === undefined) env.E2E_PRIMARY_DATABASE_URL = env.DATABASE_URL ?? "";
    env.DATABASE_URL = database;
  }
  const supabase = env.E2E_SUPABASE_URL?.trim();
  if (supabase) {
    if (env.E2E_PRIMARY_SUPABASE_URL === undefined) env.E2E_PRIMARY_SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    env.NEXT_PUBLIC_SUPABASE_URL = supabase;
    if (env.E2E_SUPABASE_ANON_KEY) env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.E2E_SUPABASE_ANON_KEY;
    if (env.E2E_SUPABASE_SERVICE_ROLE_KEY) env.SUPABASE_SERVICE_ROLE_KEY = env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  }
}

/**
 * Critical E2E isolation: the database and the Supabase project the app talks
 * to must both be disposable and be the same environment.
 */
export function assertE2EEnvironmentIsolated(env: NodeJS.ProcessEnv = process.env) {
  const database = env.E2E_DATABASE_URL?.trim();
  if (!database) throw new Error("[e2e] E2E_DATABASE_URL is required.");
  assertDisposableDatabaseUrl(database, "[e2e] E2E_DATABASE_URL", env);
  const supabase = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseIdentity = identityOrNull(supabase);
  if (!supabaseIdentity || primaryIdentities(env).has(supabaseIdentity)) {
    throw new Error("[e2e] Set E2E_SUPABASE_URL (+ keys) to the disposable Supabase project; Auth/storage must not use the primary project.");
  }
  const databaseIdentityValue = databaseIdentity(database);
  if (databaseIdentityValue.startsWith("supabase:") && databaseIdentityValue !== supabaseIdentity) {
    throw new Error(`[e2e] E2E database (${databaseIdentityValue}) and Supabase project (${supabaseIdentity}) differ.`);
  }
}
