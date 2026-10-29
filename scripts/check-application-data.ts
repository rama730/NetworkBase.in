/**
 * Read-only consistency report for role applications. It runs on a disposable database by default
 * (the project rule: check scripts never touch the live database). A read-only live run needs the
 * explicit flag below and the user's OK; every statement runs inside a READ ONLY transaction.
 *   DATABASE_URL_FRESH=$(npm run -s db:disposable) npm run check:application-data
 *   DATABASE_URL=<live> npx tsx scripts/check-application-data.ts --read-only-live
 *
 * Exits 1 when a hard invariant is broken (item 17's CHECKs would reject it); the drift counts are
 * informational and decide whether the reconcile statements in the lifecycle migration are needed.
 */
import dotenv from "dotenv";
import postgres from "postgres";

import { databaseSsl, requireDisposableDatabaseUrl } from "./lib/disposable-db";

dotenv.config({ path: ".env.local", quiet: true });

const live = process.argv.includes("--read-only-live");
const url = live ? process.env.DATABASE_URL : requireDisposableDatabaseUrl("check:application-data");
if (!url) throw new Error("DATABASE_URL is not set");
const sql = postgres(url, { max: 1, prepare: false, ssl: databaseSsl(url), onnotice: () => undefined });

const checks: Array<{ name: string; hard: boolean; query: string }> = [
  {
    name: "accepted applications without a decision time",
    hard: true,
    query: "SELECT count(*)::int AS n FROM role_applications WHERE status = 'accepted' AND decision_at IS NULL",
  },
  {
    name: "applicants over the 20-pending cap",
    hard: true,
    query: "SELECT count(*)::int AS n FROM (SELECT applicant_id FROM role_applications WHERE status = 'pending' GROUP BY 1 HAVING count(*) > 20) x",
  },
  {
    name: "messages over 2000 characters",
    hard: true,
    query: "SELECT count(*)::int AS n FROM role_applications WHERE char_length(coalesce(message, '')) > 2000",
  },
  {
    name: "roles whose filled count differs from accepted applicants who are still members",
    hard: false,
    query: `SELECT count(*)::int AS n FROM workspace_open_roles r
            WHERE r.filled <> (SELECT count(*) FROM role_applications a
                               JOIN workspace_members m ON m.workspace_id = a.workspace_id AND m.user_id = a.applicant_id
                               WHERE a.role_id = r.id AND a.status = 'accepted')`,
  },
  {
    name: "applications whose role was deleted (role_id is null)",
    hard: false,
    query: "SELECT count(*)::int AS n FROM role_applications WHERE role_id IS NULL AND status IN ('pending', 'accepted')",
  },
  {
    name: "closed-by-role-filled rows still using the old reason code",
    hard: false,
    query: "SELECT count(*)::int AS n FROM role_applications WHERE decision_reason_code = 'role_capacity_filled'",
  },
  {
    name: "pending applications whose creator_id is not the current owner",
    hard: false,
    query: "SELECT count(*)::int AS n FROM role_applications a JOIN workspaces p ON p.id = a.workspace_id WHERE a.status = 'pending' AND a.creator_id <> p.owner_id",
  },
];

async function main() {
  let hardFailures = 0;
  try {
    await sql.begin("READ ONLY", async (tx) => {
      for (const check of checks) {
        const [row] = await tx.unsafe(check.query) as unknown as Array<{ n: number }>;
        const count = Number(row?.n ?? 0);
        const flag = count === 0 ? "ok  " : check.hard ? "FAIL" : "warn";
        if (count > 0 && check.hard) hardFailures += 1;
        console.log(`${flag} ${String(count).padStart(6)}  ${check.name}`);
      }
    });
  } finally {
    await sql.end();
  }
  process.exit(hardFailures ? 1 : 0);
}

void main();
