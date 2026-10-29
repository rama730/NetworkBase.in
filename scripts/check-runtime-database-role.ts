import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  // The runtime connection (Railway's DATABASE_URL, nb_app since 0268). .env.local's DATABASE_URL stays the
  // postgres operator connection that migrations use, so this check reads RUNTIME_DATABASE_URL when set.
  const databaseUrl = process.env.RUNTIME_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("RUNTIME_DATABASE_URL or DATABASE_URL is required");

  const hostname = new URL(databaseUrl).hostname;
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    ssl: ["localhost", "127.0.0.1", "::1"].includes(hostname) ? false : "require",
  });

  try {
  const [role] = await sql<{
    roleName: string;
    bypassRls: boolean;
    superuser: boolean;
  }[]>`
    SELECT rolname AS "roleName", rolbypassrls AS "bypassRls", rolsuper AS superuser
    FROM pg_roles
    WHERE rolname = current_user
  `;

  if (!role || role.bypassRls || role.superuser) {
    throw new Error(
      `DATABASE_URL must use a least-privilege non-BYPASSRLS runtime role; current=${role?.roleName ?? "unknown"}`,
    );
  }
  console.log(`[runtime-database-role] ok (${role.roleName})`);
  } finally {
    await sql.end();
  }
}

void main();
