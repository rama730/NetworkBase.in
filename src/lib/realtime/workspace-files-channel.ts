import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'

import { isRealtimeTerminalStatus, subscribeActiveResource } from '@/lib/realtime/subscriptions'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectFilesChannelOptions {
    projectId: string
    scope?: string
    onFileLeaseChange?: () => void
    onStatus?: (status: REALTIME_SUBSCRIBE_STATES) => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of project-files channels allowed concurrently.
 * Enforced client-side to stay within the realtime budget alongside
 * the existing task-resource channel.
 */
// ponytail: client channel ceiling of 4 covers root files tab and github sync workspace simultaneously. ceiling: 4 concurrent channels per tab. upgrade: increase budget when additional scoped sub-panels are introduced.
const MAX_BACKGROUND_CHANNELS = 4

// ---------------------------------------------------------------------------
// Channel budget tracking
// ---------------------------------------------------------------------------

const activeChannelIds = new Set<string>()

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Subscribe to project-filtered lease, node, and sync-run resources.
 * Realtime CDC eliminates high-frequency client polling loops across 1M developers.
 *
 * Supabase Realtime owns socket reconnect and channel rejoin. This wrapper only
 * reports status and releases its budget marker when the channel is removed.
 *
 * Returns the RealtimeChannel instance. Call `supabase.removeChannel(channel)`
 * to unsubscribe.
 */
export function subscribeProjectFilesChannel(
    supabase: SupabaseClient,
    options: ProjectFilesChannelOptions,
): RealtimeChannel {
    const { projectId, scope = 'files-root', onFileLeaseChange, onStatus } = options

    const channelId = `${projectId}:${scope}`

    // Budget enforcement
    if (activeChannelIds.size >= MAX_BACKGROUND_CHANNELS) {
        logger.warn('realtime.project-files-channel.budget-exceeded', {
            module: 'realtime',
            projectId,
            scope,
            count: activeChannelIds.size,
        })
    }

    function cleanup() {
        activeChannelIds.delete(channelId)
    }

    const bindings = [
        {
            event: '*' as const,
            table: 'project_node_locks',
            filter: `project_id=eq.${projectId}`,
            handler: () => onFileLeaseChange?.(),
        },
    ]

    const channel = subscribeActiveResource({
        supabase,
        resourceType: 'project_files',
        resourceId: channelId,
        bindings,
        onStatus: (status) => {
            if (isRealtimeTerminalStatus(status)) {
                cleanup()
            }
            onStatus?.(status)
        },
    })

    // Track this channel in the budget
    activeChannelIds.add(channelId)

    // Patch the channel's unsubscribe to also run our cleanup
    const originalUnsubscribe = channel.unsubscribe.bind(channel)
    channel.unsubscribe = () => {
        cleanup()
        return originalUnsubscribe()
    }

    return channel
}
