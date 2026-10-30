import { z } from 'zod'

const envSchema = z.object({
    DATABASE_URL: z.string().min(1),
    APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    CSRF_TOKEN_SECRET: z.string().min(1).optional(),
    SECURITY_STEPUP_SECRET: z.string().min(1).optional(),
    SECURITY_RECOVERY_CODE_SECRET: z.string().min(1).optional(),
    AUDIT_METADATA_HASH_SECRET: z.string().min(1).optional(),
    GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
    JOB_REQUEST_SECRET: z.string().min(1).optional(),
    GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
    STORAGE_BACKUP_AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
    STORAGE_BACKUP_AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    STORAGE_BACKUP_AWS_SESSION_TOKEN: z.string().min(1).optional(),
    STORAGE_BACKUP_AWS_REGION: z.string().min(1).optional(),
    STORAGE_BACKUP_AWS_BUCKET: z.string().min(1).optional(),
    STORAGE_BACKUP_AWS_ENDPOINT: z.string().url().optional(),
    E2E_AUTH_FALLBACK: z.string().optional(),
    NEXT_PUBLIC_E2E_AUTH_FALLBACK: z.string().optional(),

    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
    INNGEST_EVENT_KEY: z.string().optional(),
    ADMIN_USER_IDS: z.string().optional(),

    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    SUPABASE_STORAGE_IMAGE_TRANSFORMATIONS_ENABLED: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

let _validated: Env | null = null

function isTruthyEnvFlag(value: string | undefined) {
    const normalized = value?.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function assertProductionSecurityEnv(env: Env) {
    if (env.NODE_ENV !== 'production') return

    const requiredSecrets = [
        ['CSRF_TOKEN_SECRET', env.CSRF_TOKEN_SECRET],
        ['SECURITY_STEPUP_SECRET', env.SECURITY_STEPUP_SECRET],
        ['SECURITY_RECOVERY_CODE_SECRET', env.SECURITY_RECOVERY_CODE_SECRET],
        ['AUDIT_METADATA_HASH_SECRET', env.AUDIT_METADATA_HASH_SECRET],
        ['GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY', env.GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY],
        ['JOB_REQUEST_SECRET', env.JOB_REQUEST_SECRET],
        ['GITHUB_WEBHOOK_SECRET', env.GITHUB_WEBHOOK_SECRET],
        ['INNGEST_EVENT_KEY', env.INNGEST_EVENT_KEY],
        ['INNGEST_SIGNING_KEY', env.INNGEST_SIGNING_KEY],
        // ponytail: STORAGE_BACKUP_AWS_* optional until the backup bucket exists; published
        // assets stay backup "pending" (never deleted early). Re-add the four names here once set.
    ] as const

    const missing = requiredSecrets
        .filter(([, value]) => !value?.trim())
        .map(([name]) => name)

    if (missing.length > 0) {
        throw new Error(`Production security environment is missing required values: ${missing.join(', ')}`)
    }

    if (isTruthyEnvFlag(env.E2E_AUTH_FALLBACK) || isTruthyEnvFlag(env.NEXT_PUBLIC_E2E_AUTH_FALLBACK)) {
        throw new Error('Production environment must not enable E2E auth fallback flags')
    }
}

export function validateEnv(rawEnv: NodeJS.ProcessEnv): Env {
    // A blank value means "not set": Docker turns a build ARG the service doesn't define into "", and an optional
    // value must not fail the build for that (the worker has no Google client ID). Required values still fail.
    const present = Object.fromEntries(Object.entries(rawEnv).filter(([, value]) => value !== undefined && value.trim() !== ''))
    const result = envSchema.safeParse(present)
    if (!result.success) {
        const missing = result.error.issues
            .map((i) => `  ${i.path.join('.')}: ${i.message}`)
            .join('\n')
        throw new Error(`Environment validation failed:\n${missing}`)
    }

    assertProductionSecurityEnv(result.data)
    return result.data
}

export function getEnv(): Env {
    if (_validated) return _validated

    _validated = validateEnv(process.env)
    return _validated
}
