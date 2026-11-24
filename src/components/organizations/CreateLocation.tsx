'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import Link from 'next/link'
import { Lock } from '@/components/ui/icons'
import { Notice } from '@/components/ui/notice'

import { messageUserInWindow } from '@/components/messages/message-user'

import { capChildVisibility, type VisibilityCap } from '@/lib/organizations/child-rules'
import type { CreateWorkspaceInput } from '@/lib/validations/workspace'

// Where a new project goes (report §14.1): Personal or one of the person's orgs, carried through the wizard.

export type CreateLocation = { id: string; title: string; slug: string | null; block: string | null; visibilityCap: string; orgPublic: boolean; isAdmin: boolean; orgType?: string | null; category?: string | null; defaultUnits?: string[]; outsidePeople?: boolean; ownerId?: string; tags?: string[]; memberUpdatesEnabled?: boolean; memberFileUploadDefault?: boolean; followSprintsDefault?: boolean }

type CreateLocationState = { locations: CreateLocation[]; locked: boolean; notice: string | null }

const LocationContext = createContext<CreateLocationState>({ locations: [], locked: false, notice: null })

export function CreateLocationProvider({ value, children }: { value: CreateLocationState; children: ReactNode }) {
    return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>
}

/** The chosen org (or null for Personal), with its rules. */
export function useCreateLocation() {
    const state = useContext(LocationContext)
    const parentOrgId = useWatch<CreateWorkspaceInput, 'parent_org_id'>({ name: 'parent_org_id' })
    return { ...state, org: state.locations.find((location) => location.id === parentOrgId) ?? null }
}

/** Phase 1: a locked "In CSE-3A" chip when opened from the org, otherwise the Where picker. */
export function WherePicker() {
    const { setValue, getValues } = useFormContext<CreateWorkspaceInput>()
    const { locations, locked, notice, org } = useCreateLocation()
    if (locations.length === 0 && !notice) return null

    const choose = (id: string) => {
        const next = locations.find((location) => location.id === id) ?? null
        setValue('parent_org_id', next?.id, { shouldDirty: true })
        // Child projects start Org only (decision 9), lowered to the org's cap; personal ones start Public.
        setValue('visibility', next ? capChildVisibility('org', next.visibilityCap as VisibilityCap, next.orgPublic) : 'public', { shouldDirty: true })
        if (next) setValue('organization', undefined, { shouldDirty: true })
        if (!next && getValues('lead_user_id')) setValue('lead_user_id', undefined)
    }

    return (
        <div className="space-y-2">
            {notice ? <Notice>{notice}</Notice> : null}
            {locked && org ? (
                <p className="inline-flex min-h-[var(--ui-control-height)] items-center gap-2 rounded-md border border-border bg-muted px-3 text-[13px]" data-testid="create-project-location-chip">
                    <Lock className="size-4 text-muted-foreground" aria-hidden="true" />In {org.title}
                </p>
            ) : locations.length > 0 ? (
                <div>
                    <label htmlFor="create-project-where" className="nb-ui-label text-foreground">Where</label>
                    <p className="nb-compact mt-0.5 text-muted-foreground">A personal workspace, or a workspace inside one of your organizations.</p>
                    <div className="mt-2">
                        <select
                            id="create-project-where"
                            value={org?.id ?? ''}
                            onChange={(event) => choose(event.target.value)}
                            className="nb-select min-w-56"
                        >
                            <option value="">Personal</option>
                            {locations.map((location) => (
                                <option key={location.id} value={location.id} disabled={Boolean(location.block)}>
                                    {location.title}{location.block ? ` (${location.block.replace(/\.$/, '').toLowerCase()})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                    {/* Report §14.2: members of an "Admins only" org can ask an admin instead. */}
                    {locations.filter((location) => location.block === 'Only admins create workspaces here.' && location.ownerId).map((location) => (
                        <p key={location.id} className="nb-compact mt-2 text-muted-foreground">
                            {location.title}: only admins create workspaces here.{' '}
                            <Link href={`/messages?userId=${location.ownerId}`} onClick={(event) => { messageUserInWindow(location.ownerId!, event) }} className="nb-link hover:underline">Message admins</Link>
                        </p>
                    ))}
                </div>
            ) : null}
        </div>
    )
}
