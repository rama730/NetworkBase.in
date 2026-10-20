import 'server-only'

import type { User } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * Writes the signed completion claim the gates read (app_metadata.onboarding_complete). The browser cannot
 * write app_metadata. `profile` also refreshes the display copy in user_metadata, as completion always did.
 */
export async function syncOnboardingClaims(params: {
    userId: string
    userMetadata?: User['user_metadata']
    appMetadata?: User['app_metadata']
    profile?: { username: string; fullName: string; avatarUrl?: string | null }
}): Promise<boolean> {
    const payload = {
        app_metadata: { ...(params.appMetadata || {}), onboarding_complete: true },
        ...(params.profile
            ? {
                user_metadata: {
                    ...(params.userMetadata || {}),
                    username: params.profile.username,
                    full_name: params.profile.fullName,
                    avatar_url: params.profile.avatarUrl || null,
                },
            }
            : {}),
    }
    const admin = await createAdminClient()

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const { error } = await admin.auth.admin.updateUserById(params.userId, payload)
        if (!error) return true
        console.error('Error syncing onboarding claims (attempt):', attempt + 1, error.message)
    }
    return false
}
