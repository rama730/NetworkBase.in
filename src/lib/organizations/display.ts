// What a state looks like and what it is called, once for every organization screen (org design plan, Task 2).

export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

const TONES: Record<string, Tone> = {
    archived: 'neutral', private: 'neutral', excused: 'neutral', not_started: 'neutral', upcoming: 'neutral', planning: 'neutral', cancelled: 'neutral', expired: 'neutral', read: 'neutral', draft: 'neutral',
    active: 'info', in_progress: 'info', published: 'info', requested: 'info', viewing_as_admin: 'info', new: 'info', updated: 'info',
    submitted: 'warning', changed: 'warning', pending: 'warning', required: 'warning', restricted: 'warning',
    approved: 'success', done: 'success', completed: 'success', verified: 'success',
    // A decision's state (report 38.3 S4).
    proposed: 'info', decided: 'success', superseded: 'neutral', reversed: 'warning',
    returned: 'danger', missing: 'danger', suspended: 'danger', late: 'danger', blocked: 'danger',
}

/** The badge tone for a state; anything unknown stays neutral rather than borrowing another state's colour. */
export function orgStatusTone(state: string): Tone {
    return TONES[state] ?? 'neutral'
}

/** Sprint status words from the organization spec §5.7: Upcoming, Active, Completed, Archived, Cancelled. */
export function sprintStatusLabel(status: string | null | undefined): string {
    switch (status) {
        case 'planning': case 'planned': case 'upcoming': return 'Upcoming'
        case 'active': case 'running': return 'Active'
        case 'completed': case 'ended': case 'done': return 'Completed'
        case 'archived': return 'Archived'
        case 'cancelled': case 'canceled': return 'Cancelled'
        default: return status ? status.charAt(0).toUpperCase() + status.slice(1) : ''
    }
}

/** Visibility words (decision D2): Public, Organization only, Private. */
export function visibilityLabel(value: string | null | undefined): string {
    if (value === 'private') return 'Private'
    if (value === 'org' || value === 'members' || value === 'members_only' || value === 'organization') return 'Organization only'
    return 'Public'
}

/** "Label · N", the one way counts sit beside a heading. */
export const withCount = (label: string, count: number) => `${label} · ${count}`

/** Field classes (spec §10 Field): 13px medium label, 13px hint and error. */
export const fieldLabel = 'text-[13px] font-medium leading-[1.2] text-foreground'
export const fieldHint = 'mt-1 text-[13px] leading-[1.5] text-muted-foreground'
export const fieldError = 'mt-1 text-[13px] leading-[1.5] text-destructive'

/** A date in the organization's zone when it has one, otherwise the reader's own (never the browser's locale words). */
export function formatOrgDate(iso: string | Date, options: Intl.DateTimeFormatOptions, timeZone?: string | null): string {
    const at = new Date(iso)
    try {
        return new Intl.DateTimeFormat('en', timeZone ? { ...options, timeZone } : options).format(at)
    } catch {
        return new Intl.DateTimeFormat('en', options).format(at)
    }
}
