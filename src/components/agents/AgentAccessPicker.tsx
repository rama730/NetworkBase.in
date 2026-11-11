'use client'

import { useId, useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'
import { describeAgentAccess, scopesForPreset, type AgentPreset } from '@/lib/agents/access'
import type { TokenScope } from '@/lib/security/token-access'

/**
 * Where, what and how long for an agent sign-in (report A2): the approval page and Settings → the agent use this one
 * picker, and both show the same sentence above it.
 */
export type AgentAccessValue = { access: AgentPreset; workspace: 'all' | string; expiryDays: 7 | 30 | 90; extraScopes: TokenScope[] }
export type AgentWorkspaceOption = { id: string; title: string; viewerOnly: boolean; org: string | null; agentsOff: boolean }

export const AGENT_EXPIRY_CHOICES = [7, 30, 90] as const
const PRESETS: { value: AgentPreset; label: string; detail: string }[] = [
    { value: 'full', label: 'Full help', detail: 'Does small things itself; asks before finishing tasks, final files, doc edits and deleting.' },
    { value: 'small', label: 'Small changes only', detail: 'Never finishes tasks, changes final files or edits docs.' },
    { value: 'read', label: 'Read only', detail: 'Looks and reports; changes nothing.' },
    { value: 'custom', label: 'Custom', detail: 'Pick what it may ask you for.' },
]
const EXTRAS: { scope: TokenScope; label: string }[] = [
    { scope: 'task:complete', label: 'Finish tasks' },
    { scope: 'file:final', label: 'Final files' },
    { scope: 'doc:write', label: 'Edit docs' },
]

/** A workspace this access can't reach: agents off in its organization, or write access to a read-only workspace. */
export function workspaceBlocked(w: AgentWorkspaceOption, access: AgentPreset) {
    if (w.agentsOff) return 'Agents off'
    return w.viewerOnly && access !== 'read' ? 'Read only' : null
}

export function agentAccessSentence(agentName: string, value: AgentAccessValue, workspaces: AgentWorkspaceOption[], now = new Date()) {
    const title = value.workspace === 'all' ? null : workspaces.find((w) => w.id === value.workspace)?.title ?? 'one workspace'
    return describeAgentAccess({ agentName, workspaceTitle: title, scopes: scopesForPreset(value.access, value.extraScopes), expiresAt: new Date(now.getTime() + value.expiryDays * 86_400_000), now })
}

export function AgentAccessPicker({ value, onChange, workspaces }: { value: AgentAccessValue; onChange: (next: AgentAccessValue) => void; workspaces: AgentWorkspaceOption[] }) {
    const id = useId()
    const [query, setQuery] = useState('')
    const set = (patch: Partial<AgentAccessValue>) => onChange({ ...value, ...patch })
    const reachable = workspaces.filter((w) => !workspaceBlocked(w, value.access)).length
    const groups = useMemo(() => {
        const q = query.trim().toLowerCase()
        const shown = q ? workspaces.filter((w) => w.title.toLowerCase().includes(q)) : workspaces
        const byGroup = new Map<string, AgentWorkspaceOption[]>()
        for (const w of shown) byGroup.set(w.org ?? '', [...(byGroup.get(w.org ?? '') ?? []), w])
        return [...byGroup.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    }, [workspaces, query])
    const one = value.workspace !== 'all'

    return (
        <div className="space-y-4 text-sm">
            <fieldset className="space-y-2">
                <legend className="mb-1 font-medium">Where</legend>
                <label className="flex items-center gap-2.5">
                    <input type="radio" className="nb-radio" name={`${id}-where`} checked={!one} onChange={() => set({ workspace: 'all' })} />
                    <span>All my workspaces <span className="text-muted-foreground">({reachable})</span></span>
                </label>
                <label className="flex items-center gap-2.5">
                    <input type="radio" className="nb-radio" name={`${id}-where`} checked={one}
                        onChange={() => set({ workspace: workspaces.find((w) => !workspaceBlocked(w, value.access))?.id ?? workspaces[0]?.id ?? 'all' })} disabled={!workspaces.length} />
                    <span>One workspace</span>
                </label>
                {one ? (
                    <div className="ml-6 space-y-2">
                        {workspaces.length > 8 ? (
                            <Input type="search" placeholder="Search workspaces" aria-label="Search workspaces" value={query} onChange={(e) => setQuery(e.target.value)} />
                        ) : null}
                        <div role="radiogroup" aria-label="Workspace" className="max-h-64 space-y-3 overflow-y-auto rounded-md border border-border p-2">
                            {groups.map(([org, list]) => (
                                <div key={org || 'own'} className="space-y-1">
                                    <p className="nb-meta px-1 text-muted-foreground">{org || 'Your workspaces'}</p>
                                    {list.map((w) => {
                                        const blocked = workspaceBlocked(w, value.access)
                                        return (
                                            <label key={w.id} className="flex min-h-9 items-center gap-2.5 rounded px-1 hover:bg-muted/50 has-[:disabled]:opacity-60">
                                                <input type="radio" className="nb-radio" name={`${id}-workspace`} checked={value.workspace === w.id} disabled={w.agentsOff} onChange={() => set({ workspace: w.id, ...(w.viewerOnly ? { access: 'read' as const } : {}) })} />
                                                <span className="min-w-0 flex-1 break-words">{w.title}</span>
                                                {blocked ? <span className="nb-meta shrink-0 rounded border border-border px-1.5 text-muted-foreground">{blocked}</span> : null}
                                            </label>
                                        )
                                    })}
                                </div>
                            ))}
                            {!groups.length ? <p className="px-1 py-2 text-muted-foreground">No workspace matches “{query}”.</p> : null}
                        </div>
                    </div>
                ) : null}
            </fieldset>

            <fieldset className="space-y-2">
                <legend className="mb-1 font-medium">What it may do</legend>
                {PRESETS.map((p) => {
                    const viewerPick = one && workspaces.find((w) => w.id === value.workspace)?.viewerOnly && p.value !== 'read'
                    return (
                        <label key={p.value} className="flex items-start gap-2.5 has-[:disabled]:opacity-60">
                            <input type="radio" className="nb-radio mt-0.5" name={`${id}-access`} checked={value.access === p.value} disabled={Boolean(viewerPick)} onChange={() => set({ access: p.value })} />
                            <span><span className="font-medium">{p.label}</span><span className="block text-muted-foreground">{viewerPick ? 'You can only read this workspace.' : p.detail}</span></span>
                        </label>
                    )
                })}
                {value.access === 'custom' ? (
                    <div className="ml-6 space-y-1.5">
                        {EXTRAS.map((x) => (
                            <label key={x.scope} className="flex items-center gap-2.5">
                                <input type="checkbox" className="nb-check" checked={value.extraScopes.includes(x.scope)}
                                    onChange={(e) => set({ extraScopes: e.target.checked ? [...value.extraScopes, x.scope] : value.extraScopes.filter((s) => s !== x.scope) })} />
                                <span>{x.label}</span>
                            </label>
                        ))}
                    </div>
                ) : null}
            </fieldset>

            <fieldset>
                <legend className="mb-2 font-medium">How long</legend>
                <div className="flex flex-wrap gap-4">
                    {AGENT_EXPIRY_CHOICES.map((d) => (
                        <label key={d} className="flex items-center gap-2">
                            <input type="radio" className="nb-radio" name={`${id}-days`} checked={value.expiryDays === d} onChange={() => set({ expiryDays: d })} />
                            <span>{d} days</span>
                        </label>
                    ))}
                </div>
            </fieldset>
        </div>
    )
}
