import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { noteSignIn } from '@/lib/auth/devices'
import { normalizeAuthNextPath, resolveAuthBaseUrl } from '@/lib/auth/redirects'
import { createClient } from '@/lib/supabase/server'

const TYPES = new Set<EmailOtpType>(['recovery', 'magiclink', 'email', 'signup'])

/**
 * The button in a reset or sign-in email. Unlike a code exchange it needs nothing from the browser that asked, so the
 * email can be opened on a phone after asking on a laptop.
 */
export async function GET(request: Request) {
    const url = new URL(request.url)
    const base = resolveAuthBaseUrl({ requestUrl: request.url, browserOrigin: url.origin })
    const tokenHash = url.searchParams.get('token_hash')?.trim() || ''
    const type = url.searchParams.get('type') as EmailOtpType | null
    const next = normalizeAuthNextPath(url.searchParams.get('next'))
    const failed = new URL(type === 'recovery' ? '/forgot-password' : '/login', base)
    failed.searchParams.set('error', type === 'recovery' ? 'reset-link-expired' : 'link-expired')

    if (!tokenHash || !type || !TYPES.has(type)) return NextResponse.redirect(failed)
    const supabase = await createClient()
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (error || !data.user) return NextResponse.redirect(failed)

    const response = NextResponse.redirect(new URL(next, base))
    await noteSignIn(request, response, data.user.id)
    return response
}
