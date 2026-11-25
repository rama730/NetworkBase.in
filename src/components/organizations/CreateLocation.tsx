'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
import Link from 'next/link'
import { ChevronDown, Lock, User } from 'lucide-react'
import { PixelPlace } from '@/components/ui/PixelPerson'
import { PixelTick } from '@/components/ui/PixelTick'
import { Notice } from '@/components/ui/notice'

import { MessageUserLink } from "@/components/messages/MessageUserLink";

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

/** The org's notice (a draft from another org, a limit) — shown under Start's tab row. */
export function WhereNotice() {
    const { notice } = useCreateLocation()
    return notice ? <Notice>{notice}</Notice> : null
}

/**
 * Start's Lives in (create wizard v6): a drop-down at the right end of the tab row — Personal or one of your
 * organizations, each with a picture and one line about what changes. Opened from an organization's page it is a
 * locked chip that says who set it. Hidden when you belong to no organization.
 */
export function WherePicker() {
    const { setValue, getValues } = useFormContext<CreateWorkspaceInput>()
    const { locations, locked, org } = useCreateLocation()
    const [open, setOpen] = useState(false)
    const boxRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!open) return
        const away = (event: MouseEvent) => { if (!boxRef.current?.contains(event.target as Node)) setOpen(false) }
        const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); boxRef.current?.querySelector<HTMLElement>('[data-where-button]')?.focus() } }
        document.addEventListener('mousedown', away)
        document.addEventListener('keydown', esc)
        return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
    }, [open])
    if (locations.length === 0) return null

    const choose = (id: string) => {
        const next = locations.find((location) => location.id === id) ?? null
        setValue('parent_org_id', next?.id, { shouldDirty: true })
        // Child projects start Org only (decision 9), lowered to the org's cap; personal ones start Public.
        setValue('visibility', next ? capChildVisibility('org', next.visibilityCap as VisibilityCap, next.orgPublic) : 'public', { shouldDirty: true })
        if (next) setValue('organization', undefined, { shouldDirty: true })
        if (!next && getValues('lead_user_id')) setValue('lead_user_id', undefined)
        setOpen(false)
    }
    const pic = (location: CreateLocation | null) => location
        ? <PixelPlace kind="organization" identityKey={location.id} size={20} className="nb-where-pic" />
        : <span className="nb-where-pic nb-where-me" aria-hidden="true"><User /></span>

    if (locked && org) {
        return (
            <p className="nb-where" data-testid="create-project-location-chip">
                <span className="nb-where-k">Lives in</span>{pic(org)}<b>{org.title}</b>
                <span className="nbs-tag"><Lock aria-hidden="true" className="size-3" />Set by {org.title}</span>
            </p>
        )
    }
    const places: Array<{ id: string; location: CreateLocation | null; line: string }> = [
        { id: '', location: null, line: 'Yours. You decide who joins. Starts public; change it in Settings.' },
        ...locations.map((location) => ({ id: location.id, location, line: location.block ?? `Inside ${location.title}. Starts members only, the most open it allows.` })),
    ]
    return (
        <div className="nb-where-box" ref={boxRef}>
            <button type="button" data-where-button className="nb-where nb-where-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                <span className="nb-where-k">Lives in</span>{pic(org)}<b>{org?.title ?? 'Personal'}</b><ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
            {open ? (
                <div role="listbox" aria-label="Lives in" className="nb-where-menu nb-enter-drop">
                    {places.map(({ id, location, line }) => {
                        const chosen = (org?.id ?? '') === id
                        return (
                            <button key={id || 'personal'} type="button" role="option" aria-selected={chosen} disabled={Boolean(location?.block)} onClick={() => choose(id)} className="nb-where-option">
                                {pic(location)}
                                <span className="min-w-0"><b>{location?.title ?? 'Personal'}</b><span>{line}</span></span>
                                {chosen ? <PixelTick className="nb-where-tick" draw /> : null}
                            </button>
                        )
                    })}
                    {/* Report §14.2: members of an "Admins only" org can ask an admin instead. */}
                    {locations.filter((location) => location.block === 'Only admins create workspaces here.' && location.ownerId).map((location) => (
                        <p key={location.id} className="nb-where-ask">
                            {location.title}: only admins create workspaces here.{' '}
                            <MessageUserLink userId={location.ownerId!} className="nb-link hover:underline">Message admins</MessageUserLink>
                        </p>
                    ))}
                </div>
            ) : null}
        </div>
    )
}
