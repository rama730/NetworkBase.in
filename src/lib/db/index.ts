import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { getEnv } from '@/lib/env'
import { logger } from '@/lib/logger'

const env = getEnv()

function usesTransactionPooler(raw: string) {
    try {
        return new URL(raw).port === '6543'
    } catch {
        return raw.includes(':6543/')
    }
}

function resolveConnectionString(raw: string) {
    if (env.NODE_ENV !== 'production') return raw
    if (process.env.DB_POOLER_MODE?.trim().toLowerCase() === 'transaction') return raw
    try {
        const url = new URL(raw)
        // ponytail: use Supavisor Session mode (5432) for persistent Railway web/worker containers so postgres.js prepared statements stay enabled and eliminate per-query Describe + pg_type round trips. ceiling: total connections across replicas must fit within the session pool limit. upgrade: set DB_POOLER_MODE=transaction if horizontal autoscaling exceeds session pool capacity.
        if (url.port === '6543' && url.hostname.endsWith('.pooler.supabase.com')) {
            url.port = '5432'
            return url.toString()
        }
    } catch {
        return raw
    }
    return raw
}

const connectionString = resolveConnectionString(env.DATABASE_URL)
const globalForDb = globalThis as unknown as { conn: postgres.Sql | undefined }

const prepare = !usesTransactionPooler(connectionString)
const defaultPoolMax = env.NODE_ENV === 'development'
    ? 5
    : process.env.INNGEST_EXECUTION_ROLE?.trim().toLowerCase() === 'worker'
        ? 3
        : 5
const client = globalForDb.conn ?? postgres(connectionString, {
    prepare,
    fetch_types: false,
    // Audit 10.1: replicas × DB_POOL_MAX must stay under the pooler's client limit; 5 web + 3 worker when unset.
    max: Number(process.env.DB_POOL_MAX) > 0 ? Number(process.env.DB_POOL_MAX) : defaultPoolMax,
    idle_timeout: 300,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
    connection: {
        // ponytail: 8 s statement cap. ceiling: slow report queries fail. upgrade: per-query SET LOCAL for known long jobs.
        statement_timeout: 8000,
        idle_in_transaction_session_timeout: 5000,
    },
    onnotice: (notice) => logger.debug('pg notice', { module: 'db', message: notice.message }),
})

// ponytail: drizzle runs every query through unsafe(), which postgres.js never prepares, so each parameterised query pays a Describe round trip. ceiling: transactions and the transaction pooler (6543) still pay it. upgrade: session pooler or a DB-region deploy for production.
if (prepare && !globalForDb.conn) {
    const unsafe = client.unsafe.bind(client)
    client.unsafe = ((query: string, args?: postgres.ParameterOrJSON<never>[], options?: postgres.UnsafeQueryOptions) =>
        unsafe(query, args, { prepare: true, ...options })) as typeof client.unsafe
}

globalForDb.conn = client

export const db = drizzle(client, { schema })

export async function pingDb(): Promise<boolean> {
    try {
        await client`SELECT 1`
        return true
    } catch {
        return false
    }
}
