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
    try {
        const url = new URL(raw)
        if (url.port === '5432' && url.hostname.endsWith('.pooler.supabase.com')) {
            url.port = '6543'
            return url.toString()
        }
    } catch {
        return raw
    }
    return raw
}

const connectionString = resolveConnectionString(env.DATABASE_URL)
const globalForDb = globalThis as unknown as { conn: postgres.Sql | undefined }

const client = globalForDb.conn ?? postgres(connectionString, {
    prepare: !usesTransactionPooler(connectionString),
    fetch_types: false,
    max: env.NODE_ENV === 'development' ? 5 : 10,
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
