import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

const envSchema = z.object({
    DATABASE_URL: z.string().min(1),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

describe('env validation schema', () => {
    it('passes with all required fields', () => {
        const result = envSchema.safeParse({
            DATABASE_URL: 'postgres://localhost:5432/test',
            NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        })
        assert.equal(result.success, true)
    })

    it('fails when DATABASE_URL is missing', () => {
        const result = envSchema.safeParse({
            NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        })
        assert.equal(result.success, false)
    })

    it('fails when NEXT_PUBLIC_SUPABASE_URL is not a URL', () => {
        const result = envSchema.safeParse({
            DATABASE_URL: 'postgres://localhost:5432/test',
            NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        })
        assert.equal(result.success, false)
    })

    it('defaults NODE_ENV to development', () => {
        const result = envSchema.safeParse({
            DATABASE_URL: 'postgres://localhost:5432/test',
            NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
        })
        assert.equal(result.success, true)
        if (result.success) {
            assert.equal(result.data.NODE_ENV, 'development')
        }
    })

    it('accepts optional Redis config', () => {
        const result = envSchema.safeParse({
            DATABASE_URL: 'postgres://localhost:5432/test',
            NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
            UPSTASH_REDIS_REST_URL: 'https://redis.example.com',
            UPSTASH_REDIS_REST_TOKEN: 'token-123',
        })
        assert.equal(result.success, true)
    })
})

// The real check, with what the worker's Docker build passes: every build ARG the service doesn't define arrives as
// "" (2026-10-30: the worker has no Google client ID, and an empty one failed its build).
describe('validateEnv (the real one)', () => {
    const base = { NODE_ENV: 'test', DATABASE_URL: 'postgres://build:build@127.0.0.1:5432/build', SUPABASE_SERVICE_ROLE_KEY: 'build-only', NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' }

    it('treats a blank optional value as unset', async () => {
        const { validateEnv } = await import('../../src/lib/env')
        const env = validateEnv({ ...base, NEXT_PUBLIC_GOOGLE_CLIENT_ID: '', NEXT_PUBLIC_APP_URL: '  ', UPSTASH_REDIS_REST_URL: '' } as unknown as NodeJS.ProcessEnv)
        assert.equal(env.NEXT_PUBLIC_GOOGLE_CLIENT_ID, undefined)
        assert.equal(env.NEXT_PUBLIC_APP_URL, undefined)
    })

    it('still fails a blank required value', async () => {
        const { validateEnv } = await import('../../src/lib/env')
        assert.throws(() => validateEnv({ ...base, NEXT_PUBLIC_SUPABASE_ANON_KEY: '' } as unknown as NodeJS.ProcessEnv), /NEXT_PUBLIC_SUPABASE_ANON_KEY/)
    })
})
