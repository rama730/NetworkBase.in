import { z } from 'zod'
import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding/contracts'

// Only what the browser alone can know. The server writes the outcomes (submit_start, submit_success,
// submit_error), so a client can never inflate the success rate behind onboarding_slo_daily.
const ONBOARDING_CLIENT_EVENT_TYPES = ['step_view', 'step_continue', 'step_back', 'step_skip', 'draft_conflict'] as const

export const onboardingEventInputSchema = z.object({
    eventType: z.enum(ONBOARDING_CLIENT_EVENT_TYPES),
    step: z.number().int().min(1).max(ONBOARDING_TOTAL_STEPS).optional(),
    metadata: z
        .record(z.string().max(64), z.union([z.string().max(300), z.number(), z.boolean(), z.null()]))
        .refine((metadata) => Object.keys(metadata).length <= 20, 'Too many metadata keys')
        .optional(),
})

export type OnboardingEventInput = z.infer<typeof onboardingEventInputSchema>

export const ONBOARDING_TELEMETRY_BATCH_LIMIT = 25

export function sanitizeOnboardingTelemetryBatch(input: unknown): OnboardingEventInput[] {
    if (!Array.isArray(input)) return []
    return input.slice(0, ONBOARDING_TELEMETRY_BATCH_LIMIT).flatMap((event) => {
        const parsed = onboardingEventInputSchema.safeParse(event)
        return parsed.success ? [parsed.data] : []
    })
}
