import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { config } from "dotenv";
import postgres from "postgres";

import { databaseSsl } from "./lib/disposable-db";

import { parseSqlGovernanceManifest } from "../src/lib/standards/sql-governance";

config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for live migration lineage validation.");
}
const resolvedDatabaseUrl = databaseUrl;

const manifest = parseSqlGovernanceManifest(
  JSON.parse(fs.readFileSync(path.join("standards", "sql-governance.manifest.json"), "utf8")),
);
const journal = JSON.parse(
  fs.readFileSync(path.join(manifest.migrationDirectory, "meta", "_journal.json"), "utf8"),
) as { entries: Array<{ idx: number; tag: string }> };

const expectedTags = journal.entries.map((entry) => entry.tag);
const expectedTagSet = new Set(expectedTags);
const legacyTagSet = new Set(manifest.legacyDatabaseTags);

function migrationChecksum(tag: string) {
  const source = fs.readFileSync(path.join(manifest.migrationDirectory, `${tag}.sql`));
  return createHash("sha256").update(source).digest("hex");
}

async function main() {
  const sql = postgres(resolvedDatabaseUrl, { ssl: databaseSsl(resolvedDatabaseUrl), prepare: false, max: 1 });
  try {
    const journalColumns = await sql<{ columnName: string }[]>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'app_migration_journal'
    `;
    const columnSet = new Set(journalColumns.map((column) => column.columnName));
    const hasChecksum = columnSet.has("checksum");
    const hasStatus = columnSet.has("status");
    const hasJournalIndex = columnSet.has("journal_index");

    const rows = hasChecksum && hasStatus && hasJournalIndex
      ? await sql<{ tag: string; checksum: string | null; status: string; appliedAt: Date; journalIndex: number | null }[]>`
          SELECT tag, checksum, status, applied_at AS "appliedAt", journal_index AS "journalIndex"
          FROM public.app_migration_journal
          ORDER BY journal_index NULLS FIRST, applied_at, tag
        `
      : await sql<{ tag: string; checksum: string | null; status: string; appliedAt: Date; journalIndex: number | null }[]>`
          SELECT tag, NULL::text AS checksum, 'completed'::text AS status, applied_at AS "appliedAt", NULL::integer AS "journalIndex"
          FROM public.app_migration_journal
          ORDER BY applied_at, tag
        `;

    const liveTags = new Set(rows.map((row) => row.tag));
    const missing = expectedTags.filter((tag) => !liveTags.has(tag));
    const unexpected = rows
      .map((row) => row.tag)
      .filter((tag) => !expectedTagSet.has(tag) && !legacyTagSet.has(tag));
    const incomplete = rows.filter(
      (row) => expectedTagSet.has(row.tag) && row.status !== "completed",
    );
    const checksumMismatches = rows.filter((row) => (
      expectedTagSet.has(row.tag)
      && row.checksum !== null
      && row.checksum !== migrationChecksum(row.tag)
    ));
    const missingChecksums = rows.filter((row) => expectedTagSet.has(row.tag) && row.checksum === null);
    const strictExpectedTags = journal.entries
      .filter((entry) => entry.idx >= manifest.strictLineageFromIndex)
      .sort((left, right) => left.idx - right.idx)
      .map((entry) => entry.tag);
    const strictLiveTags = rows
      .filter((row) => strictExpectedTags.includes(row.tag))
      .map((row) => row.tag);

    const duplicateForeignKeys = await sql<{ tableName: string; columns: string; count: number }[]>`
      SELECT
        c.conrelid::regclass::text AS "tableName",
        array_to_string(c.conkey, ',') AS columns,
        count(*)::int AS count
      FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.connamespace = 'public'::regnamespace
        -- A FK to a partitioned table gets one internal clone per partition (conparentid set).
        AND c.conparentid = 0
      GROUP BY c.conrelid, c.conkey
      HAVING count(*) > 1
      ORDER BY 1, 2
    `;

    const missingForeignKeyIndexes = await sql<{ tableName: string; constraintName: string }[]>`
      SELECT
        c.conrelid::regclass::text AS "tableName",
        c.conname AS "constraintName"
      FROM pg_constraint c
      WHERE c.contype = 'f'
        AND c.connamespace = 'public'::regnamespace
        AND c.conparentid = 0
        AND NOT EXISTS (
          SELECT 1
          FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND i.indisvalid
            AND (
              -- Leading columns are the FK columns, in any order.
              (i.indkey::smallint[])[0:cardinality(c.conkey) - 1] @> c.conkey
              -- A unique index on a subset already pins one row.
              OR (i.indisunique AND c.conkey @> (i.indkey::smallint[])[0:i.indnkeyatts - 1])
              -- Composite tenant FK (project_id, x): an index leading on x finds the rows;
              -- project_id only filters them.
              OR (
                cardinality(c.conkey) > 1
                AND (i.indkey::smallint[])[0] = ANY (c.conkey)
                AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = (i.indkey::smallint[])[0]) <> 'project_id'
              )
            )
        )
      ORDER BY 1, 2
    `;

    const errors: string[] = [];
    if (!hasChecksum || !hasStatus || !hasJournalIndex) {
      errors.push("app_migration_journal is missing checksum/status/journal_index columns; run the migration setup in an approved deployment.");
    }
    if (missing.length > 0) errors.push(`missing applied migrations: ${missing.join(", ")}`);
    if (unexpected.length > 0) errors.push(`unexpected live migration tags: ${unexpected.join(", ")}`);
    if (incomplete.length > 0) {
      errors.push(`incomplete migrations: ${incomplete.map((row) => `${row.tag}:${row.status}`).join(", ")}`);
    }
    if (checksumMismatches.length > 0) {
      errors.push(`migration checksum mismatch: ${checksumMismatches.map((row) => row.tag).join(", ")}`);
    }
    if (missingChecksums.length > 0) {
      errors.push(`migration checksum missing: ${missingChecksums.map((row) => row.tag).join(", ")}`);
    }
    if (strictLiveTags.some((tag, index) => tag !== strictExpectedTags[index])) {
      errors.push(`strict migration order mismatch: expected=${strictExpectedTags.join(",")}; live=${strictLiveTags.join(",")}`);
    }
    if (duplicateForeignKeys.length > 0) {
      errors.push(
        `duplicate foreign keys: ${duplicateForeignKeys.map((row) => `${row.tableName}[${row.columns}]x${row.count}`).join(", ")}`,
      );
    }
    if (missingForeignKeyIndexes.length > 0) {
      errors.push(
        `foreign keys without a leading index (${missingForeignKeyIndexes.length}): ${missingForeignKeyIndexes.map((row) => `${row.tableName}.${row.constraintName}`).join(", ")}`,
      );
    }

    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }

    console.log(
      `[live-migration-lineage] ok (${expectedTags.length} canonical tags, ${manifest.legacyDatabaseTags.length} legacy aliases)`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(
    "[live-migration-lineage] failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
