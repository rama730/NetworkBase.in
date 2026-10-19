import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// Load .env.local for local development
config({ path: '.env.local' })

// Studio and introspection only. Migrations are hand-written in drizzle/ (MIG-005):
// the schema holds query-only typings of SQL-owned chat partitions, so generated
// output lands outside the journal and is never applied.
export default defineConfig({
    schema: './src/lib/db/schema/index.ts',
    out: './node_modules/.drizzle-kit',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL!,
    },
})
