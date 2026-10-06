/**
 * Records every journal migration up to the baseline's `baseline-through` tag
 * as applied on a database that was just built from scripts/db/baseline/schema.sql.
 * Separate, explicit operational step (MIG-004): routine setup never infers lineage.
 * Refuses the primary database. Then `npm run db:setup` applies newer migrations.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import postgres from "postgres";

import { assertDisposableDatabaseUrl } from "../lib/disposable-db";

const url = process.argv[2];
if (!url) throw new Error("usage: tsx scripts/db/adopt-baseline.ts <disposable-database-url>");
assertDisposableDatabaseUrl(url, "db:adopt-baseline");

const baseline = readFileSync("scripts/db/baseline/schema.sql", "utf8");
const through = baseline.match(/^-- baseline-through: (\S+)$/m)?.[1];
if (!through) throw new Error("baseline header is missing `-- baseline-through: <tag>`");

const { entries } = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string }[] };
const ordered = [...entries].sort((a, b) => a.idx - b.idx);
const last = ordered.findIndex((entry) => entry.tag === through);
if (last < 0) throw new Error(`baseline tag ${through} is not in the journal`);

async function main(databaseUrl: string) {
const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const rows = ordered.slice(0, last + 1).map((entry) => ({
    tag: entry.tag,
    journal_index: entry.idx,
    checksum: createHash("sha256").update(readFileSync(`drizzle/${entry.tag}.sql`, "utf8")).digest("hex"),
  }));
  await sql`DELETE FROM public.app_migration_journal`;
  await sql`
    INSERT INTO public.app_migration_journal (tag, journal_index, checksum, status, started_at, completed_at)
    SELECT tag, journal_index, checksum, 'completed', now(), now()
    FROM unnest(${rows.map((r) => r.tag)}::text[], ${rows.map((r) => r.journal_index)}::int[], ${rows.map((r) => r.checksum)}::text[])
      AS adopted(tag, journal_index, checksum)`;
  console.log(`[db:adopt-baseline] recorded ${rows.length} migrations through ${through}`);
} finally {
  await sql.end();
}
}

main(url).catch((error) => {
  console.error("[db:adopt-baseline] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
