import { redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'

import { db } from '@/lib/db'
import { extensionDeviceSessions } from '@/lib/db/schema'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import VerifyClient from './VerifyClient'

export const metadata = buildRouteMetadata({
    title: 'Verify your terminal · NetworkBase',
    description: 'Verify it’s you so your terminal can do a risky action.',
    path: '/cli/verify',
})

/** Report F5: the page `nb` opens for a risky action. Only the person's own terminal sign-ins are named here. */
export default async function CliVerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const raw = (await searchParams).s
    const sessionId = typeof raw === 'string' && /^[0-9a-f-]{36}$/i.test(raw) ? raw : ''
    const { user } = await getViewerAuthContext()
    if (!user) redirect(`/login?next=${encodeURIComponent(`/cli/verify${sessionId ? `?s=${sessionId}` : ''}`)}`)
    const [session] = sessionId
        ? await db.select({ deviceName: extensionDeviceSessions.deviceName, clientVersion: extensionDeviceSessions.clientVersion, tokenType: extensionDeviceSessions.tokenType })
            .from(extensionDeviceSessions)
            .where(and(eq(extensionDeviceSessions.id, sessionId), eq(extensionDeviceSessions.userId, user!.id), isNull(extensionDeviceSessions.revokedAt)))
            .limit(1)
        : []
    return <VerifyClient sessionId={sessionId} device={session && session.tokenType === 'device' ? { name: session.deviceName, version: session.clientVersion ?? null } : null} />
}
