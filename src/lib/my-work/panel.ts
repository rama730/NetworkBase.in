// My work panel (shell redesign v3): the day math, labels and lines behind the ink head, the week strip, Next up and the
// time sections. Day keys are "YYYY-MM-DD"; a diff is whole days from today (negative = late, null = no date).

export type DueBucket = 'late' | 'today' | 'week' | 'later' | 'none'
export type DayKey = 'late' | number

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86_400_000
const utc = (key: string) => Date.parse(`${key}T00:00:00Z`)

export const dayDiff = (dueKey: string | null | undefined, todayKey: string): number | null =>
    dueKey ? Math.round((utc(dueKey) - utc(todayKey)) / DAY_MS) : null

export const addDaysKey = (todayKey: string, days: number) => new Date(utc(todayKey) + days * DAY_MS).toISOString().slice(0, 10)

const weekday = (todayKey: string, offset: number) => new Date(utc(todayKey) + offset * DAY_MS).getUTCDay()
export const dayName = (todayKey: string, offset: number) => DAYS[weekday(todayKey, offset)]!
export const fullDayName = (todayKey: string, offset: number) => FULL_DAYS[weekday(todayKey, offset)]!

/** Days until the coming Monday (1–7), for "Move to · Next week". */
export const nextMondayOffset = (todayKey: string) => ((8 - weekday(todayKey, 0)) % 7) || 7

export function bucketOf(diff: number | null): DueBucket {
    if (diff == null) return 'none'
    if (diff < 0) return 'late'
    if (diff === 0) return 'today'
    return diff < 7 ? 'week' : 'later'
}

export const BUCKETS: Array<{ id: DueBucket; label: string }> = [
    { id: 'late', label: 'Late' },
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This week' },
    { id: 'later', label: 'Later' },
    { id: 'none', label: 'No date' },
]

export function dueLabel(diff: number | null, todayKey: string): string {
    if (diff == null) return ''
    if (diff < 0) return `${-diff}d late`
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Tomorrow'
    if (diff < 7) return dayName(todayKey, diff)
    const date = new Date(utc(todayKey) + diff * DAY_MS)
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`
}

/** Late, today, then the next six days. */
export const weekColumns = (todayKey: string): Array<{ key: DayKey; label: string }> => [
    { key: 'late', label: 'Late' },
    ...Array.from({ length: 7 }, (_, offset) => ({ key: offset, label: offset === 0 ? 'Today' : dayName(todayKey, offset) })),
]

export const inDay = (diff: number | null, day: DayKey) => day === 'late' ? diff != null && diff < 0 : diff === day

/** The most urgent task of yours you can act on now: not someone else's, not blocked, not waiting in review. */
export function pickNextUp<T extends { diff: number | null; mine: boolean; status: string; inReview: boolean }>(tasks: T[]): T | null {
    const actionable = tasks.filter((task) => task.mine && !task.inReview && (task.status === 'todo' || task.status === 'in_progress'))
    return actionable.sort((a, b) => (a.diff ?? 9_999) - (b.diff ?? 9_999))[0] ?? null
}

/** The serif line on the Tasks tab; `em` is the part in orange. */
export function inkLine(input: { late: number; today: number; week: number; total: number; day: DayKey | null; dayCount?: number; dayName?: string }): { em: string; rest: string } {
    const { late, today, week, total, day } = input
    if (day === 'late') return { em: `${late} late.`, rest: ' Start with these.' }
    if (day != null) {
        const n = input.dayCount ?? 0
        return { em: '', rest: `${n} due ${day === 0 ? 'today' : day === 1 ? 'tomorrow' : `on ${input.dayName ?? 'that day'}`}.` }
    }
    if (!total) return { em: '', rest: 'All clear.' }
    if (late) return { em: `${late} late`, rest: `, ${today ? `${today} due today` : `${week} due this week`}.` }
    if (today) return { em: '', rest: `${today} ${today === 1 ? 'thing is' : 'things are'} due today.` }
    if (week) return { em: '', rest: `${week} ${week === 1 ? 'thing' : 'things'} due this week.` }
    return { em: '', rest: 'Nothing due this week.' }
}

/** The serif line on the Requests tab: people waiting first, then invitations. */
export function requestsLine(people: number, invitations: number): { em: string; rest: string } {
    if (people) return { em: `${people} ${people === 1 ? 'person is' : 'people are'}`, rest: ' waiting on you.' }
    if (invitations) return { em: `${invitations} ${invitations === 1 ? 'invitation' : 'invitations'}`, rest: ' to answer.' }
    return { em: '', rest: 'All caught up.' }
}
