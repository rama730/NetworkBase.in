'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { onboardingEvents } from '@/lib/db/schema'
import { consumeRateLimit } from '@/lib/security/rate-limit'
import { SIGNIN_FLIGHT_EVENT_TYPES } from '@/lib/auth/signin-flight'
import { createClient } from '@/lib/supabase/server'

const inputSchema = z.object({
  event: z.enum(SIGNIN_FLIGHT_EVENT_TYPES),
  /** Milliseconds since the flight started. */
  ms: z.number().int().min(0).max(60_000),
  reduced: z.boolean(),
  phone: z.boolean(),
  version: z.enum(['full', 'light']),
  /** Where the photo began: the sign-in button, or the middle (after a page reload). */
  from: z.enum(['button', 'center']),
})

/**
 * What happened to the sign-in welcome flight, for the people who run the product: started, completed, or skipped,
 * which version, and how long it took. Best effort: it never blocks the person and a failure is ignored.
 */
export async function recordSignInFlight(input: unknown): Promise<{ success: boolean }> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { success: false }
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (!data.user) return { success: false }
    // People sign in a few times a day; the limit only stops a script from filling the table.
    const rate = await consumeRateLimit(`signin:flight:${data.user.id}`, 40, 3600)
    if (!rate.allowed) return { success: false }
    const { event, ...metadata } = parsed.data
    await db.insert(onboardingEvents).values({ userId: data.user.id, eventType: event, step: null, metadata })
    return { success: true }
  } catch {
    return { success: false }
  }
}
