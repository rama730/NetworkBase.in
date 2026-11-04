// Workspaces report (2026-11-04-org-workspaces-tab-findings.md §1, §4 F1, G7–G9): each reason a workspace needs an
// admin becomes a label with its own fix, and the status bar's counts come from the same rows the cards show.

export type AttentionKind = 'overdue' | 'quiet' | 'lead' | 'group'
export type AttentionAction = 'board' | 'remind' | 'assign' | 'assignment' | 'review'
export type AttentionItem = { kind: AttentionKind; label: string; action: AttentionAction; actionLabel: string }

type Row = { reasons: string[]; needsLead: boolean; status: string | null; mine: boolean; groupCopy: { title: string } | null }

const ACTION_LABEL: Record<AttentionAction, string> = { board: 'Open board', remind: 'Remind workspace lead', assign: 'Assign', assignment: 'Open assignment', review: 'Open review' }
const item = (kind: AttentionKind, label: string, action: AttentionAction): AttentionItem => ({ kind, label, action, actionLabel: ACTION_LABEL[action] })

/** The reasons from `needsAttention`, plus a lead handover, as the card's amber line shows them. */
export function attentionItems(row: Row): AttentionItem[] {
    if (row.status === 'archived') return []
    const out: AttentionItem[] = []
    const assignment = row.groupCopy?.title ?? 'The group assignment'
    for (const reason of row.reasons) {
        if (/^\d+ overdue$/.test(reason)) out.push(item('overdue', reason, 'board'))
        else if (reason === 'quiet 7 days') out.push(item('quiet', 'Quiet 7 days', 'remind'))
        else if (reason === 'group assignment missing') out.push(item('group', `${assignment} not handed in`, 'assignment'))
        else if (reason === 'group assignment returned') out.push(item('group', `${assignment} returned`, 'review'))
        else if (reason === 'lead left the organization') out.push(item('lead', 'Needs a new workspace lead', 'assign'))
    }
    if (row.needsLead && !out.some((i) => i.kind === 'lead')) out.push(item('lead', 'Needs a new workspace lead', 'assign'))
    return out
}

export const needsAttentionRow = (row: Row) => attentionItems(row).length > 0

/** The status bar's numbers, from the rows themselves (members get no attention or archived numbers). */
export function workspacesSummary(rows: Row[], isAdmin: boolean) {
    const live = rows.filter((r) => r.status !== 'archived')
    return {
        total: live.length,
        attention: isAdmin ? live.filter(needsAttentionRow).length : 0,
        quiet: isAdmin ? live.filter((r) => r.reasons.includes('quiet 7 days')).length : 0,
        archived: isAdmin ? rows.length - live.length : 0,
        mine: live.filter((r) => r.mine).length,
    }
}

/** How many rows each reason chip under Needs attention would show. */
export function reasonCounts(rows: Row[]): Record<AttentionKind, number> {
    const counts: Record<AttentionKind, number> = { overdue: 0, quiet: 0, lead: 0, group: 0 }
    for (const r of rows) for (const kind of new Set(attentionItems(r).map((i) => i.kind))) counts[kind] += 1
    return counts
}
