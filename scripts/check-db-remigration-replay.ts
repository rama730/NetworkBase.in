/**
 * Replay gate (MIG-001, MIG-002). Builds from an empty database:
 *   export DATABASE_URL_FRESH=$(npm run -s db:disposable)
 * 1. Setup applies the journal to the fresh database.
 * 2. Ownership: every public relation is declared in the ORM schema or is
 *    listed as SQL-owned below.
 * 3. Parity: the fresh effective catalog (policies with expressions, grants,
 *    functions, constraints, indexes, triggers) equals the primary's. The
 *    primary is only read.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { config } from "dotenv";
import postgres from "postgres";

import { catalogFingerprint, diffFingerprints } from "./lib/catalog-fingerprint";
import { databaseSsl, requireDisposableDatabaseUrl } from "./lib/disposable-db";

config({ path: ".env.local", quiet: true });

/** Relations owned by SQL alone: the runner's journal, raw-SQL chat tables and views. */
const SQL_OWNED_RELATIONS = new Set([
  "app_migration_journal",
  "chat_channel_tabs",
  "chat_saved",
  "chat_scheduled_messages",
  "onboarding_slo_daily",
]);

const primaryUrl = process.env.DATABASE_URL;
if (!primaryUrl) throw new Error("DATABASE_URL (the primary, read only) is required.");
const freshUrl = requireDisposableDatabaseUrl("check:db:remigration-replay");

function run(args: string[], env: Record<string, string>) {
  const result = spawnSync(process.execPath, ["--import", "tsx", ...args], { stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${args.join(" ")} exited with status ${result.status ?? result.signal}`);
}

function ormTables() {
  const schema = readFileSync("src/lib/db/schema/index.ts", "utf8");
  return new Set([...schema.matchAll(/\bpgTable\(\s*["']([^"']+)["']/g)].map((match) => match[1]!));
}

async function fingerprint(url: string) {
  const sql = postgres(url, { ssl: databaseSsl(url), prepare: false, max: 1, onnotice: () => undefined });
  try {
    return await catalogFingerprint(sql);
  } finally {
    await sql.end();
  }
}

async function pendingMigrations(url: string) {
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
  const sql = postgres(url, { ssl: databaseSsl(url), prepare: false, max: 1 });
  try {
    const rows = await sql<{ tag: string }[]>`SELECT tag FROM public.app_migration_journal WHERE status = 'completed'`;
    const applied = new Set(rows.map((row) => row.tag));
    return journal.entries.map((entry) => entry.tag).filter((tag) => !applied.has(tag));
  } finally {
    await sql.end();
  }
}

function fail(label: string, lines: string[]) {
  throw new Error(`${label} (${lines.length}):\n${lines.slice(0, 200).join("\n")}`);
}

async function main() {
  run(["scripts/check-migration-journal.ts"], {});

  // Setup skips tags already in the journal, so a second pass would prove nothing.
  console.log("[db-remigration] applying the journal to the fresh database...");
  run(["scripts/setup-database.ts"], { DATABASE_URL: freshUrl });
  const afterFirst = await fingerprint(freshUrl);

  const declared = ormTables();
  const relations = afterFirst
    .filter((line) => line.startsWith("relation public."))
    .map((line) => line.split(" ")[1]!.slice("public.".length));
  const unowned = relations.filter((name) => !declared.has(name) && !SQL_OWNED_RELATIONS.has(name));
  const missing = [...declared].filter((name) => !relations.includes(name));
  if (unowned.length > 0 || missing.length > 0) {
    fail("ownership mismatch", [...unowned.map((name) => `not declared in ORM or SQL_OWNED_RELATIONS: ${name}`), ...missing.map((name) => `declared in ORM but absent: ${name}`)]);
  }

  // Parity needs the primary at the journal head. Until a rollout has applied the newest
  // migrations the comparison would be vacuous, so it fails unless explicitly allowed.
  const pending = await pendingMigrations(primaryUrl!);
  if (pending.length > 0 && process.env.REPLAY_ALLOW_PENDING !== "1") {
    throw new Error(`parity not checked: the primary has not applied ${pending.join(", ")}. Roll out first, or set REPLAY_ALLOW_PENDING=1 to skip parity.`);
  }
  if (pending.length > 0) {
    console.warn(`[db-remigration] parity skipped (REPLAY_ALLOW_PENDING=1): primary lacks ${pending.join(", ")}.`);
  } else {
    const drift = diffFingerprints(await fingerprint(primaryUrl!), afterFirst);
    if (drift.length > 0) fail("catalog drift (- primary only, + replay only)", drift);
    console.log(`[db-remigration] parity: ${afterFirst.length} catalog lines match the primary.`);
  }

  run(["scripts/check-onboarding-slo.ts"], { DATABASE_URL: freshUrl });
  console.log("[db-remigration] replay validation passed.");
}

main().catch((error) => {
  console.error("[db-remigration] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
