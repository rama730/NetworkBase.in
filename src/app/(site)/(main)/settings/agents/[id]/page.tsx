import { notFound, redirect } from 'next/navigation'

import AgentAccessSettings from '@/components/settings/AgentAccessSettings'
import { agentSettingsView } from '@/lib/agents/access-settings'
import { listAgentWorkspaces } from '@/lib/extension/device-codes'
import { buildRouteMetadata } from '@/lib/metadata/route-metadata'
import { getViewerAuthContext } from '@/lib/server/viewer-context'

export function generateMetadata() {
    return buildRouteMetadata({ title: 'AI agent access · NetworkBase', description: 'What an AI agent may do, where, and for how long.', path: '/settings', robots: { index: false, follow: false } })
}

/** One agent sign-in: its sentence, requests waiting for an answer, Change access and Renew (report A4, A5, A8). */
export default async function AgentSettingsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const [{ id }, query] = await Promise.all([params, searchParams])
    const { user } = await getViewerAuthContext()
    if (!user) redirect(`/login?next=${encodeURIComponent(`/settings/agents/${id}`)}`)
    if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
    const [view, workspaces] = await Promise.all([agentSettingsView(user.id, id), listAgentWorkspaces(user.id, { includeViewer: true })])
    if (!view) notFound()
    const request = typeof query.request === 'string' ? query.request : null
    return <AgentAccessSettings view={view} workspaces={workspaces} focusRequest={request} />
}
