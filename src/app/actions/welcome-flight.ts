'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { onboardingEvents } from '@/lib/db/schema'
import { WELCOME_FLIGHT_EVENT_TYPES } from '@/lib/onboarding/welcome-flight'
import { consumeRateLimit } from '@/lib/security/rate-limit'
import { createClient } from '@/lib/supabase/server'

const inputSchema = z.object({
  event: z.enum(WELCOME_FLIGHT_EVENT_TYPES),
  /** Milliseconds since the click. */
  ms: z.number().int().min(0).max(60_000),
  reduced: z.boolean(),
  phone: z.boolean(),
  /** Whether the presence step was part of this run. */
  presence: z.boolean(),
})

/**
 * What happened to the welcome flight, for the people who run the product: started, completed, or skipped, and how
 * long it took. Best effort: it never blocks the person and a failure is ignored.
 */
export async function recordWelcomeFlight(input: unknown): Promise<{ success: boolean }> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { success: false }
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (!data.user) return { success: false }
    // A person sees this once; the limit only stops a script from filling the table.
    const rate = await consumeRateLimit(`onboarding:welcome-flight:${data.user.id}`, 12, 3600)
    if (!rate.allowed) return { success: false }
    const { event, ...metadata } = parsed.data
    await db.insert(onboardingEvents).values({ userId: data.user.id, eventType: event, step: null, metadata })
    return { success: true }
  } catch {
    return { success: false }
  }
}
