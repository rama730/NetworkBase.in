'use client'

import { OrganizationCreatedScreen } from '@/components/organizations/OrganizationCreatedScreen'
import type { CreateLocation } from '@/components/organizations/CreateLocation'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/feedback'
import { queryKeys } from '@/lib/query-keys'
import CreateProjectWizard from './CreateProjectWizard'
import { CreateProjectShellSkeleton } from './CreateProjectShellSkeleton'
import { clearCreateProjectReturnPath, readCreateProjectReturnPath } from './create-project-return'
import {
    clearGithubOAuthResume,
    getCreateProjectReturnPath,
    parseCreateProjectSource,
    readGithubOAuthResume,
    type CreateProjectGithubOAuthResume,
    type CreateProjectSource,
} from './github-oauth-resume'

interface CreateProjectRouteClientProps {
    initialSource?: CreateProjectSource | null
    createLocations?: CreateLocation[]
    initialOrgId?: string | null
    locationNotice?: string | null
}

type Handoff = { source: CreateProjectSource | null; resume: CreateProjectGithubOAuthResume | null }

/** The only home of the create-project wizard: the /projects/new page (spec §18). */
export function CreateProjectRouteClient({
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
    const [createdOrg, setCreatedOrg] = useState<{ projectId: string; title: string; joinCode: string } | null>(null)

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const returnPath = getCreateProjectReturnPath(window.location)
        const resume = readGithubOAuthResume(returnPath)

        if (params.get('githubIdentity') === 'error' || params.has('error')) {
            toast.error('GitHub authorization was not completed. Your draft was preserved.')
        }

        const rawParamSource = params.get('source') ?? params.get('createProjectSource')
        setHandoff({
            source: parseCreateProjectSource(rawParamSource)
                ?? resume?.values.import_source?.type
                ?? initialSource,
            resume,
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
        router.replace(readCreateProjectReturnPath() ?? '/discover')
    }, [router])

    const handleSuccess = useCallback((projectId: string, organization?: { title: string; joinCode: string }) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsSimpleRoot() })
        void queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.discoverRoot() })
        void queryClient.invalidateQueries({ queryKey: queryKeys.profile.root() })
        clearCreateProjectReturnPath()
        if (organization) return setCreatedOrg({ projectId, ...organization })
        // Replace so Back from the new project does not reopen the wizard.
        router.replace(`/projects/${projectId}`)
    }, [queryClient, router])

    const handleResumeRestored = useCallback((resumeId: string) => {
        clearGithubOAuthResume(resumeId)
    }, [])

    const handleSourceChange = useCallback((source: CreateProjectSource | null) => {
        const url = new URL(window.location.href)
        if (source) {
            url.searchParams.set('source', source)
        } else {
            url.searchParams.delete('source')
        }
        window.history.replaceState(window.history.state, '', url.pathname + url.search)
    }, [])

    if (createdOrg) {
        return <OrganizationCreatedScreen {...createdOrg} onContinue={() => router.replace(`/projects/${createdOrg.projectId}`)} />
    }
    if (!handoff) return <CreateProjectShellSkeleton />

    return (
        <CreateProjectWizard
            onClose={handleClose}
            onSuccess={handleSuccess}
            initialSource={handoff.source}
            onSourceChange={handleSourceChange}
            githubOAuthResume={handoff.resume}
            onGithubOAuthResumeRestored={handleResumeRestored}
            createLocations={createLocations}
            initialOrgId={initialOrgId}
            locationNotice={locationNotice}
        />
    )
}
