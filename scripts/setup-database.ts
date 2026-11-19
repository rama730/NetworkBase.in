/**
 * Database setup now delegates to the checked-in Drizzle migration journal.
 * Run with: npx tsx scripts/setup-database.ts
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import postgres from "postgres";

import { databaseSsl } from "./lib/disposable-db";
import * as dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

type JournalEntry = {
  idx: number;
  tag: string;
};

type JournalFile = {
  entries: JournalEntry[];
};

type AppliedMigration = {
  tag: string;
  checksum: string | null;
  status: "applying" | "completed" | "failed";
  journalIndex: number | null;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes("--dry-run") || process.env.MIGRATION_DRY_RUN === "1";
const JOURNAL_TABLE = "app_migration_journal";
const MIGRATION_LOCK_KEY = "nb-s3:migration-setup";
const NON_TRANSACTIONAL_MIGRATIONS = new Set<string>(["0027_drop_redundant_indexes", "0068_org_hot_path_indexes", "0104_task_types_index"]);

if (!DATABASE_URL && !DRY_RUN) {
  console.error("❌ DATABASE_URL not found in .env.local");
  process.exit(1);
}


// Session-level advisory locks need a session: Supavisor's transaction pooler
// (port 6543) hands each statement to a different backend.
if (DATABASE_URL && !DRY_RUN && new URL(DATABASE_URL).port === "6543") {
  console.error("❌ Migrations need a direct/session connection, not the transaction pooler (port 6543).");
  process.exit(1);
}

// max: 1 keeps the lock, journal bootstrap, every migration statement and the
// unlock on one reserved session (MIG-003).
const sql = postgres(DATABASE_URL || "postgres://dry-run.invalid/unused", {
  max: 1,
  prepare: false,
  ssl: databaseSsl(DATABASE_URL),
});

function resolveWorkspacePath(...parts: string[]) {
  return path.join(process.cwd(), ...parts);
}

async function readJournal(): Promise<JournalFile> {
  const source = await readFile(resolveWorkspacePath("drizzle", "meta", "_journal.json"), "utf8");
  return JSON.parse(source) as JournalFile;
}

/** First install only; an existing journal is verified, never reshaped (MIG-004). */
async function ensureJournalTable() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS public.${JOURNAL_TABLE} (
      tag text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      checksum text,
      status text NOT NULL DEFAULT 'completed'
        CONSTRAINT app_migration_journal_status_check CHECK (status IN ('applying', 'completed', 'failed')),
      started_at timestamptz,
      completed_at timestamptz,
      error_message text,
      journal_index integer
    );
    CREATE UNIQUE INDEX IF NOT EXISTS app_migration_journal_index_unique
      ON public.${JOURNAL_TABLE} (journal_index)
      WHERE journal_index IS NOT NULL;
  `);
}

async function acquireMigrationLock() {
  const [row] = await sql<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(hashtext(${MIGRATION_LOCK_KEY})) AS locked`;
  if (!row?.locked) throw new Error("Another migration run holds the migration lock; retry after it finishes.");
}

async function releaseMigrationLock() {
  await sql`SELECT pg_advisory_unlock(hashtext(${MIGRATION_LOCK_KEY}))`;
}

async function readAppliedMigrations() {
  const rows = await sql<AppliedMigration[]>`
    SELECT tag, checksum, status, journal_index AS "journalIndex"
    FROM public.app_migration_journal
    ORDER BY applied_at ASC, tag ASC
  `;
  return new Map(rows.map((row) => [row.tag, row]));
}

function splitMigrationStatements(source: string) {
  return source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function readMigration(tag: string) {
  const filePath = resolveWorkspacePath("drizzle", `${tag}.sql`);
  const source = await readFile(filePath, "utf8");
  return {
    checksum: createHash("sha256").update(source).digest("hex"),
    statements: splitMigrationStatements(source),
  };
}

async function validateMigrationSources(entries: JournalEntry[]) {
  const seenIndexes = new Set<number>();
  const seenTags = new Set<string>();

  for (const entry of [...entries].sort((a, b) => a.idx - b.idx)) {
    if (seenIndexes.has(entry.idx)) throw new Error(`Duplicate migration index: ${entry.idx}`);
    if (seenTags.has(entry.tag)) throw new Error(`Duplicate migration tag: ${entry.tag}`);
    seenIndexes.add(entry.idx);
    seenTags.add(entry.tag);

    const { statements } = await readMigration(entry.tag);
    if (statements.length === 0) throw new Error(`Migration ${entry.tag} has no executable statements.`);
    const containsConcurrentOperation = statements.some((statement) => /\bCONCURRENTLY\b/i.test(statement));
    if (containsConcurrentOperation && !NON_TRANSACTIONAL_MIGRATIONS.has(entry.tag)) {
      throw new Error(
        `Migration ${entry.tag} contains a concurrent operation but is not allowlisted as non-transactional.`,
      );
    }
  }
}

async function databaseHasExistingApplicationSchema() {
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name NOT IN (${JOURNAL_TABLE})
  `;
  return (rows[0]?.count ?? 0) > 0;
}

async function applyMigration(entry: JournalEntry) {
  const { checksum, statements } = await readMigration(entry.tag);
  const isNonTransactional = NON_TRANSACTIONAL_MIGRATIONS.has(entry.tag);

  console.log(
    `📦 Applying migration ${entry.tag} (${statements.length} statement${statements.length === 1 ? "" : "s"}, ${isNonTransactional ? "non-transactional" : "transactional"})`,
  );

  await sql`
    INSERT INTO public.app_migration_journal (
      tag,
      checksum,
      journal_index,
      status,
      started_at,
      completed_at,
      error_message
    )
    VALUES (${entry.tag}, ${checksum}, ${entry.idx}, 'applying', now(), null, null)
    ON CONFLICT (tag) DO UPDATE
    SET checksum = EXCLUDED.checksum,
        journal_index = EXCLUDED.journal_index,
        status = 'applying',
        started_at = now(),
        completed_at = null,
        error_message = null
  `;

  try {
    if (isNonTransactional) {
      for (const statement of statements) {
        await sql.unsafe(statement);
      }
      await sql`
        UPDATE public.app_migration_journal
        SET status = 'completed',
            applied_at = now(),
            completed_at = now(),
            error_message = null
        WHERE tag = ${entry.tag}
      `;
      return;
    }

    await sql.begin(async (transaction) => {
      for (const statement of statements) {
        await transaction.unsafe(statement);
      }
      await transaction.unsafe(
        `UPDATE public.app_migration_journal
         SET status = 'completed',
             applied_at = now(),
             completed_at = now(),
             error_message = null
         WHERE tag = $1`,
        [entry.tag],
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      UPDATE public.app_migration_journal
      SET status = 'failed',
          completed_at = now(),
          error_message = ${message.slice(0, 2000)}
      WHERE tag = ${entry.tag}
    `;
    throw error;
  }
}

/**
 * Applied rows must match the journal exactly. A missing or different checksum
 * or index is reported, never rewritten: lineage repair is a separate, reviewed
 * operation, not routine setup.
 */
async function verifyAppliedLineage(entries: JournalEntry[], appliedMigrations: Map<string, AppliedMigration>) {
  const problems: string[] = [];
  for (const entry of entries) {
    const applied = appliedMigrations.get(entry.tag);
    if (!applied || applied.status !== "completed") continue;
    const { checksum } = await readMigration(entry.tag);
    if (applied.checksum !== checksum) {
      problems.push(applied.checksum ? `${entry.tag}: checksum differs (applied migrations are immutable; add a new migration)` : `${entry.tag}: checksum missing`);
    }
    if (applied.journalIndex !== entry.idx) problems.push(`${entry.tag}: journal_index ${applied.journalIndex ?? "missing"}, expected ${entry.idx}`);
  }
  if (problems.length > 0) throw new Error(`Applied migration lineage does not match the journal:\n${problems.join("\n")}`);
}

async function setupDatabase() {
  console.log("🚀 Starting database setup via Drizzle migrations...\n");
  const journal = await readJournal();
  await validateMigrationSources(journal.entries);

  if (DRY_RUN) {
    console.log(`✅ Validated ${journal.entries.length} migration sources without connecting to the database.`);
    await sql.end();
    return;
  }

  await acquireMigrationLock();
  try {
    // A migration that can't get its table lock fails in seconds. Without this it waits out statement_timeout,
    // and every query on that table queues behind it meanwhile, stalling the live site. Override with
    // MIGRATION_LOCK_TIMEOUT (e.g. "30s").
    await sql.unsafe(`SET lock_timeout = '${(process.env.MIGRATION_LOCK_TIMEOUT ?? "5s").replace(/[^0-9a-z]/gi, "")}'`);
    await ensureJournalTable();
    const appliedMigrations = await readAppliedMigrations();
    if (appliedMigrations.size === 0 && await databaseHasExistingApplicationSchema()) {
      throw new Error(
        "Database contains application tables without migration lineage. Routine setup never infers it; " +
        "build from an empty database, or record the lineage by hand after review.",
      );
    }
    await verifyAppliedLineage(journal.entries, appliedMigrations);

    let appliedCount = 0;
    for (const entry of journal.entries.sort((a, b) => a.idx - b.idx)) {
      const applied = appliedMigrations.get(entry.tag);
      if (applied?.status === "completed") {
        continue;
      }
      await applyMigration(entry);
      appliedCount += 1;
    }

    if (appliedCount === 0) {
      console.log("✅ Database already matches the migration journal.");
    } else {
      // PostgREST caches the database catalog. Reload it only after the full
      // migration batch commits so newly added tables and columns become
      // available to Supabase clients as one coherent schema.
      await sql.unsafe("NOTIFY pgrst, 'reload schema'");
      console.log(`✅ Applied ${appliedCount} migration${appliedCount === 1 ? "" : "s"} from the journal.`);
    }

  } finally {
    await releaseMigrationLock().catch(() => undefined);
    await sql.end();
  }
}

setupDatabase().catch((error) => {
  console.error("❌ Database setup failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
