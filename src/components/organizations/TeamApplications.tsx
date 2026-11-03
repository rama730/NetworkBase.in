'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'

import { acceptApplicationAction, rejectApplicationAction } from '@/app/actions/applications'
import { readTeamApplicationsAction, type TeamApplication } from '@/app/actions/child-units'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/workspaces/settings/SettingsFormFields'
import { toast } from '@/lib/feedback'

// Team applications in a workspace's Settings (step 11 gap): the organization's admins decide them too (decision 159).

export function TeamApplications({ projectId }: { projectId: string }) {
    const [rows, setRows] = useState<TeamApplication[] | null>(null)
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void readTeamApplicationsAction(projectId).then((r) => setRows(r.success ? r.applications : [])), [projectId])
    useEffect(() => { load() }, [load])
    if (!rows?.length) return null
    const decide = (row: TeamApplication, accept: boolean) => startTransition(async () => {
        const result = accept ? await acceptApplicationAction(row.id) : await rejectApplicationAction(row.id)
        if (!result.success) return void toast.error(result.error ?? 'Couldn’t save that. Try again.')
        toast.success(accept ? `${row.name} is in ${row.team}` : 'Application declined')
        load()
    })
    return (
        <SettingsCard title="Applications" headingLevel={2} description="People asking to join a team here.">
            <ul className="divide-y divide-border text-sm">
                {rows.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-2 py-2">
                        <span className="min-w-0 flex-1"><span className="font-medium">{row.name}</span> <span className="text-muted-foreground">for {row.team}</span>
                            {row.message ? <span className="block text-muted-foreground">“{row.message}”</span> : null}</span>
                        <Button type="button" size="sm" disabled={pending} onClick={() => decide(row, true)}>Accept</Button>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide(row, false)}>Decline</Button>
                    </li>
                ))}
            </ul>
        </SettingsCard>
    )
}
