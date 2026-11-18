'use server'

import { suggestAddress, type Suggestion } from '@/lib/errors/suggest'
import { readViewerPlaces } from '@/lib/errors/viewer-places'
import { consumeRateLimit } from '@/lib/security/rate-limit'
import { getViewerAuthContext } from '@/lib/server/viewer-context'

/**
 * What a 404 needs once it is actually on screen: whether the viewer is signed in, and the closest of their own
 * workspaces or organizations to the address. Only signed-in viewers on a /workspaces or /org address cost a lookup,
 * at most 30 a minute; nothing else about the viewer's places leaves the server.
 */
export async function notFoundContextAction(path: string): Promise<{ signedIn: boolean; place: Extract<Suggestion, { kind: 'place' }> | null }> {
    const { user } = await getViewerAuthContext()
    if (!user) return { signedIn: false, place: null }
    const section = String(path).split('/')[1]
    if (section !== 'workspaces' && section !== 'org') return { signedIn: true, place: null }
    if (!(await consumeRateLimit(`not-found:places:${user.id}`, 30, 60)).allowed) return { signedIn: true, place: null }
    const places = await readViewerPlaces(user.id).catch(() => [])
    const suggestion = suggestAddress(String(path).slice(0, 300), places)
    return { signedIn: true, place: suggestion?.kind === 'place' ? suggestion : null }
}
