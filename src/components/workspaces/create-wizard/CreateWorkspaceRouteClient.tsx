'use client'

import { OrganizationCreatedScreen, type CreatedOrganization } from '@/components/organizations/OrganizationCreatedScreen'
import type { CreateLocation } from '@/components/organizations/CreateLocation'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/feedback'
import { queryKeys } from '@/lib/query-keys'
import CreateWorkspaceWizard from './CreateWorkspaceWizard'
import type { CreateFinished } from './useCreateWorkspaceWizard'
import { CreateWorkspaceShellSkeleton } from './CreateWorkspaceShellSkeleton'
import { clearCreateWorkspaceReturnPath, readCreateWorkspaceReturnPath } from './create-workspace-return'
import {
    clearGithubOAuthResume,
    getCreateWorkspaceReturnPath,
    parseCreateWorkspaceSource,
    readGithubOAuthResume,
    type CreateWorkspaceGithubOAuthResume,
    type CreateWorkspaceSource,
} from './github-oauth-resume'

interface CreateProjectRouteClientProps {
    initialSource?: CreateWorkspaceSource | null
    createLocations?: CreateLocation[]
    initialOrgId?: string | null
    locationNotice?: string | null
}

type Handoff = { source: CreateWorkspaceSource | null; resume: CreateWorkspaceGithubOAuthResume | null; organization: boolean }

/** The only home of the create-project wizard: the /workspaces/new page (spec §18). */
export function CreateWorkspaceRouteClient({
    initialSource = null,
    createLocations = [],
    initialOrgId = null,
    locationNotice = null,
}: CreateProjectRouteClientProps) {
    const router = useRouter()
    const queryClient = useQueryClient()
    // The wizard mounts once, with restored values, so it waits for the GitHub hand-off to be read.
    const [handoff, setHandoff] = useState<Handoff | null>(null)
    // A new org shows its join code once before going to it (report §6, After creation).
    const [createdOrg, setCreatedOrg] = useState<(CreatedOrganization & { projectId: string }) | null>(null)

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const returnPath = getCreateWorkspaceReturnPath(window.location)
        const resume = readGithubOAuthResume(returnPath)

        if (params.get('githubIdentity') === 'error' || params.has('error')) {
            toast.error('GitHub authorization was not completed', { description: 'Your draft was preserved.' })
        }

        const rawParamSource = params.get('source') ?? params.get('createProjectSource')
        setHandoff({
            source: parseCreateWorkspaceSource(rawParamSource)
                ?? resume?.values.import_source?.type
                ?? initialSource,
            resume,
            // "Create an organization" on the landing page and in the teacher guide (report §45.8).
            organization: params.get('start') === 'organization',
        })
        if (
            params.has('createProject')
            || params.has('createProjectSource')
            || params.has('githubIdentity')
            || params.has('error')
            || params.has('error_description')
        ) {
            window.history.replaceState(window.history.state, '', returnPath)
        }
    }, [initialSource])

    // Replace, not back: after a GitHub sign-in the previous history entry is github.com.
    const handleClose = useCallback(() => {
        router.replace(readCreateWorkspaceReturnPath() ?? '/discover')
    }, [router])

    const handleSuccess = useCallback((projectId: string, organization?: CreatedOrganization) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsSimpleRoot() })
        void queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.discoverRoot() })
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile.root() })
        clearCreateWorkspaceReturnPath()
        if (organization) return setCreatedOrg({ projectId, ...organization })
        // Workspaces report §4 F2: made inside an organization, it shows on top of its Workspaces tab. The Finish view
        // says so with "Back to {org}" (create wizard v6), so no toast.
        for (const org of createLocations) void queryClient.invalidateQueries({ queryKey: ['org-workspaces', org.id] })
    }, [createLocations, queryClient])

    // Finish → Open. Replace so Back from the new workspace does not reopen the wizard.
    const handleOpen = useCallback((finished: CreateFinished) => {
        router.replace(`/workspaces/${encodeURIComponent(finished.slug ?? finished.projectId)}`)
    }, [router])
    // Finish → Create another: a fresh wizard on the same page.
    const [wizardKey, setWizardKey] = useState(0)
    const handleCreateAnother = useCallback(() => {
        setCreatedOrg(null)
        // A fresh wizard: never the values a GitHub sign-in round trip brought back for the last one.
        setHandoff((current) => (current ? { ...current, resume: null } : current))
        setWizardKey((key) => key + 1)
    }, [])

    const handleResumeRestored = useCallback((resumeId: string) => {
        clearGithubOAuthResume(resumeId)
    }, [])

    const handleSourceChange = useCallback((source: CreateWorkspaceSource | null) => {
        const url = new URL(window.location.href)
        if (source) {
            url.searchParams.set('source', source)
        } else {
            url.searchParams.delete('source')
        }
        window.history.replaceState(window.history.state, '', url.pathname + url.search)
    }, [])

    if (createdOrg) {
        return <OrganizationCreatedScreen {...createdOrg} onContinue={() => router.replace(`/org/${encodeURIComponent(createdOrg.handle ?? createdOrg.projectId)}`)} />
    }
    if (!handoff) return <CreateWorkspaceShellSkeleton />

    return (
        <CreateWorkspaceWizard
            key={wizardKey}
            onClose={handleClose}
            onSuccess={handleSuccess}
            onOpen={handleOpen}
            onCreateAnother={handleCreateAnother}
            initialSource={handoff.source}
            startAsOrganization={handoff.organization}
            onSourceChange={handleSourceChange}
            githubOAuthResume={handoff.resume}
            onGithubOAuthResumeRestored={handleResumeRestored}
            createLocations={createLocations}
            initialOrgId={initialOrgId}
            locationNotice={locationNotice}
        />
    )
}
