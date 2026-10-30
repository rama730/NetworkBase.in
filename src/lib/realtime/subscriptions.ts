import { subscribeBroadcast, type BroadcastStatus } from '@/lib/realtime/private-broadcast'
import { userTopic } from '@/lib/messaging/constants'

type DbRealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE'

export type DbRealtimePayload = {
    eventType?: DbRealtimeEventType
    new: Record<string, unknown> | null
    old: Record<string, unknown> | null
}

export type UserNotificationEvent =
    | { kind: 'profile'; payload: DbRealtimePayload }
    | { kind: 'notification'; payload: DbRealtimePayload }

/** Private topics filled by drizzle/0034_live_row_events.sql; each follows its table's read rule. */
export const liveTopics = {
    workspace: (id: string) => `live:workspace:${id}`,
    tasks: (workspaceId: string) => `live:tasks:${workspaceId}`,
    task: (id: string) => `live:task:${id}`,
    files: (workspaceId: string) => `live:files:${workspaceId}`,
}

/** The database event's `{ op, new, old }` (safe columns only) in the shape the screens read. */
export function toRowChange(payload: Record<string, unknown>): DbRealtimePayload {
    return {
        eventType: payload.op as DbRealtimeEventType | undefined,
        new: (payload.new as Record<string, unknown> | null | undefined) ?? null,
        old: (payload.old as Record<string, unknown> | null | undefined) ?? null,
    }
}

export function subscribeUserNotifications(params: {
    userId: string
    onEvent: (event: UserNotificationEvent) => void
    onStatus?: (status: BroadcastStatus) => void
}) {
    const { userId, onEvent, onStatus } = params
    return subscribeBroadcast(userTopic(userId), (event, payload) => {
        if (event === 'notification.changed') onEvent({ kind: 'notification', payload: toRowChange(payload) })
        else if (event === 'profile.changed') onEvent({ kind: 'profile', payload: toRowChange(payload) })
    }, onStatus)
}
