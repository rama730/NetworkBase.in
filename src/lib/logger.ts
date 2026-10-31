import { captureException, captureMessage } from '@sentry/nextjs'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
    module?: string
    userId?: string
    requestId?: string
    sampleRate?: number
    [key: string]: unknown
}

const REDACT_KEY_PATTERN = /password|token|secret|authorization/i
const ALLOWED_CONTEXT_KEY_PATTERN = /^(module|domain|outcome|queryLengthBucket|tokenCount|resultCount|userId|viewerUserId|subjectUserId|targetUserId|actorUserId|requestId|sampleRate|route|action|status|success|errorCode|error|errors|failed|total|failedWrites|traceId|source|message|failureKind|reason|failureReason|eventType|event|type|kind|scope|channelId|channelSeq|projectId|taskId|nodeId|attachmentId|sessionId|uploadIntentId|deliveryId|resourceType|resourceId|durationMs|count|remainingCount|sizeBytes|totalBytes|chunkCount|generatedCount|requestedCount|available|blocked|canViewProfile|visibilityReason|connectionState|currentPercent|targetPercent|runId|metric|normalizedUsername|bucket|contentType|limit|offset|cursor|attempt|attempted|scheduled|claimed|deleted|retryable|verified|oldestAgeMs|value|unit|phase|allowed|routePath|path|code|routeId|subjectCount|viewerCount|finalized|removedObjects|expiredIntents|expiredPins|nextCursor|hasMore|version|createdAt|updatedAt|finalizedAt|redeemedAt|expiresAt|remaining|statusCode|method|inputTokens|outputTokens|totalTokens|promptCredits|queue|depth|capped|_type|extra|correlationId|restoredFromVersion|newVersion|ts)$/;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function isVerboseConsoleLoggingEnabled() {
    return process.env.NODE_ENV !== 'production'
        && (process.env.NEXT_PUBLIC_VERBOSE_APP_LOGS === '1' || process.env.VERBOSE_APP_LOGS === '1')
}

function shouldLog(level: LogLevel): boolean {
    const minLevel: LogLevel = isVerboseConsoleLoggingEnabled() ? 'debug' : 'warn'
    return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel]
}

function shouldSample(level: LogLevel, message: string, context?: LogContext): boolean {
    if (level === 'warn' || level === 'error') return true

    const sampleRate = typeof context?.sampleRate === 'number'
        ? Math.max(0, Math.min(1, context.sampleRate))
        : 1
    if (sampleRate >= 1) return true
    if (sampleRate <= 0) return false

    // Use deterministic sampling only when requestId is present (consistent per-request)
    if (context?.requestId) {
        const seed = String(context.requestId)
        let hash = 0
        for (let index = 0; index < seed.length; index += 1) {
            hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
        }
        return (hash % 10_000) / 10_000 < sampleRate
    }
    // Non-deterministic sampling for general logs
    return Math.random() < sampleRate
}

// Most server errors are caught and logged rather than thrown, so this is where Sentry hears about them.
// A monitoring failure must never break the request that was logging.
function reportToSentry(message: string, safeContext: Record<string, unknown>, error: unknown) {
    try {
        const scope = {
            extra: safeContext,
            fingerprint: ['logger', scrubMessage(message)],
            ...(typeof safeContext.userId === 'string' ? { user: { id: safeContext.userId } } : {}),
        }
        if (error instanceof Error) captureException(error, scope)
        else captureMessage(message, { ...scope, level: 'error' })
    } catch {
        // The console line above still records the error.
    }
}

function emit(level: LogLevel, message: string, context?: LogContext) {
    if (!shouldLog(level)) return
    if (!shouldSample(level, message, context)) return

    const { sampleRate: _sampleRate, ...safeContext } = sanitizeContext(context || {})
    const entry = { level, msg: message, ts: Date.now(), ...safeContext }
    const verboseConsoleLogs = isVerboseConsoleLoggingEnabled()

    switch (level) {
        case 'error':
            console.error("[logger]", entry)
            reportToSentry(message, safeContext, context?.error)
            break
        case 'warn':
            console.warn("[logger]", entry)
            break
        case 'debug':
            if (verboseConsoleLogs) {
                console.debug("[logger]", entry)
            }
            break
        default:
            if (verboseConsoleLogs) {
                console.info("[logger]", entry)
            }
            break
    }
}

function emitMetric(metric: string, payload: Record<string, unknown>) {
    const context = { ...payload, _type: 'metric' }
    if (!shouldSample('info', metric, context)) return
    // Production collectors consume stdout. Metrics must not depend on the
    // verbose application-log switch or they disappear at the release build.
    if (process.env.NODE_ENV !== 'production' && !isVerboseConsoleLoggingEnabled()) return
    const { sampleRate: _sampleRate, ...safeContext } = sanitizeContext(context)
    console.info("[logger]", { level: 'info', msg: metric, ts: Date.now(), ...safeContext })
}

// Stacks and raw messages can carry secrets (SEC-011): stacks are opt-in outside production,
// and the token, credential and query-string formats we know of are scrubbed from messages.
function isStackLoggingEnabled() {
    return process.env.NODE_ENV !== 'production' || process.env.LOG_ERROR_STACKS === '1'
}

const MESSAGE_SCRUBBERS: Array<[RegExp, string]> = [
    [/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '[JWT]'],
    [/\bBearer\s+[\w.~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
    [/(\b[a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@'],
    [/(\bhttps?:\/\/[^\s?#]*)\?[^\s#]*/gi, '$1?[REDACTED]'],
    [/\b((?:\w*(?:password|token|secret|apikey|api_key|authorization)\w*)\s*[=:]\s*)[^\s,;&"']+/gi, '$1[REDACTED]'],
]

export function scrubMessage(message: string) {
    return MESSAGE_SCRUBBERS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), message)
}

function sanitizeValue(key: string, value: unknown): unknown {
    if (REDACT_KEY_PATTERN.test(key)) return '[REDACTED]'
    if (typeof value === 'string') {
        const isMessageKey = key === 'error' || key === 'message' || key === 'msg' || key === 'reason' || key === 'failureReason';
        if (!isMessageKey && REDACT_KEY_PATTERN.test(value)) return '[REDACTED]'
        const text = isMessageKey ? scrubMessage(value) : value
        return text.length > 500 ? `${text.slice(0, 497)}...` : text
    }
    if (Array.isArray(value)) {
        return value.slice(0, 20).map((item) => sanitizeValue(key, item))
    }
    if (value instanceof Error) {
        const code = (value as { code?: unknown }).code
        return {
            name: value.name,
            ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
            message: scrubMessage(value.message),
            ...(isStackLoggingEnabled() ? { stack: scrubMessage(value.stack ?? '') } : {}),
        }
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([childKey]) => ALLOWED_CONTEXT_KEY_PATTERN.test(childKey) && !REDACT_KEY_PATTERN.test(childKey))
            .map(([childKey, childValue]) => [childKey, sanitizeValue(childKey, childValue)])
        return Object.fromEntries(entries)
    }
    return value
}

function sanitizeContext(context: LogContext): LogContext {
    const sanitizedEntries = Object.entries(context)
        .filter(([key]) => ALLOWED_CONTEXT_KEY_PATTERN.test(key) && !REDACT_KEY_PATTERN.test(key))
        .map(([key, value]) => [key, sanitizeValue(key, value)])
    return Object.fromEntries(sanitizedEntries)
}

export const logger = {
    debug: (message: string, context?: LogContext) => emit('debug', message, context),
    info:  (message: string, context?: LogContext) => emit('info', message, context),
    warn:  (message: string, context?: LogContext) => emit('warn', message, context),
    error: (message: string | Error, context?: LogContext) => {
        if (message instanceof Error) {
            emit('error', message.message, { ...context, error: message })
        } else {
            emit('error', message, context)
        }
    },
    metric: (metric: string, payload: Record<string, unknown>) => {
        emitMetric(metric, payload)
    },
}
