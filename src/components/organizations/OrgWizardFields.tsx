'use client'

import { useEffect, useRef, useState } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'

import { checkOrgHandleAction } from '@/app/actions/organizations'
import { Input } from '@/components/ui/input'
import { generateSlugBase } from '@/lib/utils/slug'
import type { CreateProjectInput } from '@/lib/validations/project'

// The organization-only fields of the create wizard (report §6). Each group drops into its phase when
// the starting point is Organization; everything else in the wizard stays as it is.

const labelClass = 'text-sm font-medium text-foreground'
const helpClass = 'mt-1.5 text-[13px] leading-[1.5] text-muted-foreground'

/** Phase 2: @handle with a live availability check, and optional term dates. */
export function OrgInformationFields() {
    const { register, setValue, getValues } = useFormContext<CreateProjectInput>()
    const title = useWatch<CreateProjectInput, 'title'>({ name: 'title' }) || ''
    const handle = useWatch<CreateProjectInput, 'organization.handle'>({ name: 'organization.handle' }) || ''
    const [status, setStatus] = useState<{ available: boolean; message: string } | null>(null)
    const edited = useRef(Boolean(getValues('organization.handle')))

    // Suggested from the name ("CSE-3A 2026" -> cse-3a-2026) until the person types their own.
    useEffect(() => {
        if (!edited.current) setValue('organization.handle', generateSlugBase(title).slice(0, 40), { shouldDirty: true })
    }, [setValue, title])

    useEffect(() => {
        if (handle.trim().length < 3) return setStatus(null)
        let cancelled = false
        const timer = setTimeout(() => {
            void checkOrgHandleAction(handle).then((result) => {
                if (!cancelled) setStatus(result)
            })
        }, 350)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [handle])

    return (
        <div className="space-y-5">
            <div>
                <label htmlFor="create-org-handle" className={labelClass}>Handle</label>
                <div className="mt-1.5 flex items-center gap-1">
                    <span className="text-muted-foreground" aria-hidden="true">@</span>
                    <Input
                        id="create-org-handle"
                        {...register('organization.handle', { onChange: () => { edited.current = true } })}
                        maxLength={40}
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby="create-org-handle-help create-org-handle-status"
                    />
                </div>
                <p id="create-org-handle-help" className={helpClass}>Your organization&apos;s address. Letters, numbers and dashes.</p>
                <p id="create-org-handle-status" role="status" aria-live="polite" className={status && !status.available ? 'mt-1 text-[13px] text-destructive' : 'mt-1 text-[13px] text-muted-foreground'}>
                    {status?.message}
                </p>
            </div>
            <fieldset>
                <legend className={labelClass}>Term or period (optional)</legend>
                <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
                    <label className="text-[13px] text-muted-foreground">
                        Starts
                        <Input type="date" {...register('organization.term_start')} className="mt-1" />
                    </label>
                    <label className="text-[13px] text-muted-foreground">
                        Ends
                        <Input type="date" {...register('organization.term_end')} className="mt-1" />
                    </label>
                </div>
            </fieldset>
        </div>
    )
}

/** Phase 3 for orgs: your title and how people join. Open roles don't apply; people join with the code. */
export function OrgPeopleFields() {
    const { register } = useFormContext<CreateProjectInput>()
    const orgType = useWatch<CreateProjectInput, 'organization.org_type'>({ name: 'organization.org_type' })
    return (
        <div className="space-y-6">
            <div>
                <label htmlFor="create-org-title" className={labelClass}>Your title</label>
                <Input
                    id="create-org-title"
                    {...register('organization.creator_title')}
                    className="mt-1.5"
                    maxLength={60}
                    placeholder={orgType === 'education' ? 'Teacher' : 'Owner'}
                />
                <p className={helpClass}>Shown beside your name in the organization.</p>
            </div>
            <fieldset>
                <legend className={labelClass}>How people join</legend>
                <p className={helpClass}>Everyone joins with the join code you get after creating. Co-admins and role names are set up in Members and Settings.</p>
                <div className="mt-3 space-y-2">
                    <label className="flex items-start gap-3">
                        <input type="radio" value="instant" {...register('organization.join_mode')} className="mt-1" />
                        <span><span className="block text-sm font-medium">Instant</span><span className="block text-[13px] text-muted-foreground">Anyone with the code becomes a member.</span></span>
                    </label>
                    <label className="flex items-start gap-3">
                        <input type="radio" value="approval" {...register('organization.join_mode')} className="mt-1" />
                        <span><span className="block text-sm font-medium">Approval required</span><span className="block text-[13px] text-muted-foreground">The code sends a request; an admin approves it.</span></span>
                    </label>
                </div>
            </fieldset>
        </div>
    )
}

/** Phase 4 additions for orgs: who creates child projects and whether outside people can be added to them. */
export function OrgSettingsFields() {
    const { register } = useFormContext<CreateProjectInput>()
    return (
        <div className="space-y-6">
            <fieldset>
                <legend className={labelClass}>Who can create projects inside the organization</legend>
                <div className="mt-3 space-y-2">
                    <label className="flex items-center gap-3 text-sm">
                        <input type="radio" value="members" {...register('organization.child_creation')} /> All members
                    </label>
                    <label className="flex items-center gap-3 text-sm">
                        <input type="radio" value="admins" {...register('organization.child_creation')} /> Admins only
                    </label>
                </div>
            </fieldset>
            <label className="flex items-start gap-3">
                <input type="checkbox" {...register('organization.outside_people')} className="mt-1" />
                <span>
                    <span className="block text-sm font-medium">People outside the organization can be added to its projects</span>
                    <span className="block text-[13px] text-muted-foreground">Off by default. They see only that project, never the organization&apos;s content.</span>
                </span>
            </label>
        </div>
    )
}
