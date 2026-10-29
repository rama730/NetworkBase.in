/**
 * Deletes the e2e fixture accounts (`@example.com` addresses) from the database `.env.local` points at.
 *
 *   npx tsx scripts/delete-fixture-accounts.ts            # dry run: lists what would go
 *   npx tsx scripts/delete-fixture-accounts.ts --confirm  # deletes them
 *
 * Destructive and irreversible. Read the dry-run list first; the delete goes through Supabase Auth, so
 * everything that cascades from the auth user goes with it.
 */
import { config } from "dotenv";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

import { FIXTURE_EMAIL_PATTERN } from "../src/lib/accounts/fixture-accounts";

config({ path: ".env.local" });

const confirm = process.argv.includes("--confirm");

async function main() {
    const { DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
    const sql = postgres(DATABASE_URL, { max: 1 });
    try {
        const rows = await sql<{ id: string; email: string; username: string | null; projects: number; updates: number }[]>`
            SELECT p.id, p.email, p.username,
                   (SELECT count(*) FROM workspaces pr WHERE pr.owner_id = p.id)::int AS workspaces,
                   (SELECT count(*) FROM workspace_updates pu WHERE pu.author_id = p.id)::int AS updates
            FROM profiles p
            WHERE p.email ILIKE ${FIXTURE_EMAIL_PATTERN}
            ORDER BY p.created_at`;
        console.log(`${confirm ? "Deleting" : "Would delete"} ${rows.length} fixture account(s):`);
        for (const row of rows) console.log(`  ${row.email}  @${row.username ?? "-"}  workspaces=${row.projects} updates=${row.updates}`);
        if (!confirm) {
            console.log("Dry run: nothing deleted. Re-run with --confirm to delete.");
            return;
        }
        if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase URL and service role key are required");
        const admin = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
        let failed = 0;
        for (const row of rows) {
            const { error } = await admin.auth.admin.deleteUser(row.id);
            if (error) {
                failed += 1;
                console.error(`  failed: ${row.email}: ${error.message}`);
            }
        }
        console.log(`Done: ${rows.length - failed} deleted, ${failed} failed.`);
        if (failed) process.exitCode = 1;
    } finally {
        await sql.end();
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
