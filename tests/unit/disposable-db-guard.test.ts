import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDisposableDatabaseUrl,
  assertE2EEnvironmentIsolated,
  bindE2EEnvironment,
  databaseIdentity,
  requireDisposableDatabaseUrl,
} from "../../scripts/lib/disposable-db";

const PROD = "iutauehhgdymtpzrnzcy";
const BRANCH = "abcdefghijklmnopqrst";
const prodDirect = `postgresql://postgres:x@db.${PROD}.supabase.co:5432/postgres`;
const prodPooler = `postgresql://postgres.${PROD}:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const branchDirect = `postgresql://postgres:x@db.${BRANCH}.supabase.co:5432/postgres`;

test("pooler, direct and API URLs of one project share an identity", () => {
  assert.equal(databaseIdentity(prodDirect), `supabase:${PROD}`);
  assert.equal(databaseIdentity(prodPooler), `supabase:${PROD}`);
  assert.equal(databaseIdentity(`https://${PROD}.supabase.co`), `supabase:${PROD}`);
  assert.equal(databaseIdentity("postgresql://postgres@127.0.0.1:54329/nb"), "pg:localhost:54329/nb");
});

test("an alias of the primary database is refused (OPS-003/OPS-004)", () => {
  const env = { DATABASE_URL: prodDirect } as NodeJS.ProcessEnv;
  assert.throws(() => assertDisposableDatabaseUrl(prodPooler, "t", env), /primary database/);
  assert.equal(assertDisposableDatabaseUrl(branchDirect, "t", env), branchDirect);
  assert.throws(() => requireDisposableDatabaseUrl("t", env), /requires/);
});

test("E2E rebinding remembers the primary and requires a disposable Supabase project", () => {
  const env = {
    DATABASE_URL: prodDirect,
    NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
    E2E_DATABASE_URL: branchDirect,
  } as NodeJS.ProcessEnv;
  bindE2EEnvironment(env);
  assert.equal(env.DATABASE_URL, branchDirect);
  assert.throws(() => assertE2EEnvironmentIsolated(env), /E2E_SUPABASE_URL/);

  env.E2E_SUPABASE_URL = `https://${BRANCH}.supabase.co`;
  bindE2EEnvironment(env);
  bindE2EEnvironment(env); // second process: primaries stay the original ones
  assert.equal(env.E2E_PRIMARY_DATABASE_URL, prodDirect);
  assert.doesNotThrow(() => assertE2EEnvironmentIsolated(env));

  const aliased = { DATABASE_URL: prodDirect, E2E_DATABASE_URL: prodPooler, E2E_SUPABASE_URL: `https://${BRANCH}.supabase.co` } as NodeJS.ProcessEnv;
  bindE2EEnvironment(aliased);
  assert.throws(() => assertE2EEnvironmentIsolated(aliased), /primary database/);
});

test("CI declares no primary; database and Supabase project must still match", () => {
  const env = {
    E2E_PRIMARY_DATABASE_URL: "",
    E2E_PRIMARY_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_URL: `https://${BRANCH}.supabase.co`,
    E2E_DATABASE_URL: branchDirect,
  } as NodeJS.ProcessEnv;
  bindE2EEnvironment(env);
  assert.doesNotThrow(() => assertE2EEnvironmentIsolated(env));
  env.NEXT_PUBLIC_SUPABASE_URL = `https://${PROD}.supabase.co`;
  assert.throws(() => assertE2EEnvironmentIsolated(env), /differ/);
});
