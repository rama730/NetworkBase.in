import { caseLabel, type Severity } from '@/lib/trust/rules'

// Console formatting (17.3, 17.14): severity badges on the shared status chip, deadlines in words, dates in IST.

const SEVERITY_STATUS: Record<Severity, string> = { urgent: 'blocked', high: 'draft', normal: 'archived' }

export function SeverityBadge({ severity }: { severity: Severity }) {
    return <span className="nb-status" data-status={SEVERITY_STATUS[severity]}>{severity}</span>
}

export function StateBadge({ state, outcome }: { state: string; outcome?: string | null }) {
    const text = state === 'in_review' ? 'In review' : state === 'decided' ? (outcome === 'no_violation' ? 'No violation' : 'Actioned') : state === 'closed' ? (outcome ?? 'Closed') : 'Open'
    return <span className="nb-status" data-status={state === 'decided' || state === 'closed' ? 'completed' : 'active'}>{text.replace('_', ' ')}</span>
}

const span = (ms: number) => {
    const m = Math.round(Math.abs(ms) / 60_000)
    return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

/** "due in 42m", amber below a quarter of the time left, red "overdue 3h" (17.3). */
export function Deadline({ at, openedAt, done }: { at: string | null; openedAt: string; done?: boolean }) {
    if (!at || done) return null
    const left = new Date(at).getTime() - Date.now()
    const total = new Date(at).getTime() - new Date(openedAt).getTime()
    const tone = left < 0 ? 'text-[var(--status-danger)]' : left < total / 4 ? 'text-[var(--status-warning)]' : 'text-muted-foreground'
    return <span className={`nb-meta ${tone}`} title={istDateTime(at)}>{left < 0 ? `overdue ${span(left)}` : `due in ${span(left)}`}</span>
}

export const istDateTime = (value: string | Date | null | undefined) => value
    ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(value)) + ' IST'
    : '—'
export const istDate = (value: string | Date | null | undefined) => value
    ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(value))
    : '—'

/** Relative under a week, then a short date (17.14). */
export function ago(value: string | null | undefined) {
    if (!value) return '—'
    const ms = Date.now() - new Date(value).getTime()
    return ms < 60_000 ? 'just now' : ms < 7 * 86_400_000 ? `${span(ms)} ago` : istDate(value)
}

export const caseHref = (number: number) => `/admin/trust/cases/${caseLabel(number)}`
