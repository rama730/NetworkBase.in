import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { cache, Suspense } from 'react';
import ProjectDashboardClient from '@/components/projects/dashboard/ProjectDashboardClient';
import { readProjectDetailShell, readProjectSprintDetail } from '@/app/actions/project';
import ProjectDetailLoading from './loading';
import { PrivateOrgHeader } from '@/components/organizations/PrivateOrgHeader';
import { readOrgCard, resolveHeldOrgHandle } from '@/lib/organizations/detail';
import { getViewerIdentityContext, toClientViewer } from '@/lib/server/viewer-context';
import { shareMetadata } from '@/lib/sharing/metadata';
import { readSharePreview } from '@/lib/sharing/read';
import { genericSharePreview, isShareCrawler, shareOrigin } from '@/lib/sharing/presentation';
import { isProjectTabVisibleToViewer } from '@/lib/projects/settings-policies';

const readProjectSprintDetailCached = cache((slugOrId: string, limit?: number, sprintId?: string, taskReference?: string) => readProjectSprintDetail({ slugOrId, limit, sprintId, taskReference }));

export type RouteSearchParams = Record<string, string | string[] | undefined>;
/** Projects live at /projects/<slug>; organizations at /org/<handle> (report §24). Same page underneath. */
export type ProjectRouteBase = '/projects' | '/org';

function queryStringOf(searchParams: RouteSearchParams | undefined) {
    // Repeated params survive as repeated params (`a=1&a=2`), never as a joined "1,2".
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams ?? {})) {
        for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
    }
    const queryString = query.toString();
    return queryString ? `?${queryString}` : '';
}

/** First value of a repeated query param (`?tab=a&tab=b` reads as "a"). */
function firstParam(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}

// Metadata and the rendered route share one auth-qualified shell read.
const readProjectRouteShell = cache(async (slugOrId: string) => {
    const [viewerIdentity, result] = await Promise.all([
        getViewerIdentityContext(),
        readProjectDetailShell({ slugOrId }),
    ]);
    return { viewerIdentity, result };
});

export async function generateProjectRouteMetadata({
    params,
    searchParams,
    base = '/projects',
}: {
    params: Promise<{ slug: string }>; 
    searchParams: Promise<RouteSearchParams>;
    base?: ProjectRouteBase;
}): Promise<Metadata> {
    const [{ slug }, _searchParams] = await Promise.all([params, searchParams]);
    const url = new URL(`${base}/${encodeURIComponent(slug)}`, shareOrigin()).href;
    const preview = await readSharePreview(url);
    const metadata = shareMetadata(preview ?? genericSharePreview({ kind: 'project', identifier: slug, url }, 'unavailable'));

    const tab = firstParam(_searchParams?.tab);
    if (tab && preview?.state === 'ready' && !isShareCrawler((await headers()).get('user-agent'))) {
        const tabTitleMap: Record<string, string> = {
            updates: "Project Feed",
            sprints: "Sprints",
            settings: "Settings",
            privacy: "Settings",
            about: "About",
            readme: "Docs",
            docs: "Docs",
            files: "Files",
            tasks: "Tasks",
            members: "Members",
            projects: "Projects",
        };
        const tabTitle = tabTitleMap[tab];
        if (tabTitle) {
            const { result } = await readProjectRouteShell(slug);
            if (result.success) {
                const { project, capabilities } = result.data;
                const isOwnerOrMember = capabilities.isOwner || capabilities.isMember;
                const canManageSettings = capabilities.isOwner;
                const isVisible = isProjectTabVisibleToViewer({
                    tabId: tab === 'privacy' ? 'settings' : tab,
                    isOwnerOrMember,
                    canManageSettings,
                    publicTabVisibility: project.publicTabVisibility,
                    isOrganization: Boolean(project.organization),
                });
                if (isVisible) {
                    metadata.title = `${tabTitle} | ${project.title} | NetworkBase`;
                }
            }
        }
    }

    return metadata;
}

async function ResolvedProjectDashboard({
    base,
    params,
    searchParams
}: {
    base: ProjectRouteBase;
    params: Promise<{ slug: string }>;
    searchParams: Promise<RouteSearchParams>;
}) {
    const [{ slug }, _searchParams] = await Promise.all([params, searchParams]);
    if (isShareCrawler((await headers()).get('user-agent'))) {
        const preview = await readSharePreview(new URL(`/projects/${encodeURIComponent(slug)}`, shareOrigin()).href);
        return <article className="p-6"><h1>{preview?.title ?? 'Project on NetworkBase'}</h1><p>{preview?.description ?? 'Open this project on NetworkBase.'}</p><a href={preview?.url ?? '/discover'}>Open NetworkBase</a></article>;
    }
    const selectedTab = firstParam(_searchParams?.tab) || "dashboard";
    const sprintId = firstParam(_searchParams?.sprint) ?? firstParam(_searchParams?.sprintId);
    const sprintPromise = selectedTab === "sprints"
        ? readProjectSprintDetailCached(slug, 24, sprintId, firstParam(_searchParams?.task) ?? firstParam(_searchParams?.taskId))
        : null;
    sprintPromise?.catch(() => null);
    const { viewerIdentity, result } = await readProjectRouteShell(slug);
    const { user } = viewerIdentity;
    const clientViewer = toClientViewer(viewerIdentity);

    if (!result.success) {
        // An org's old handle redirects for 90 days; a private org shows outsiders only its minimal header.
        if (result.errorCode === 'NOT_FOUND' && base === '/org') {
            const current = await resolveHeldOrgHandle(slug);
            if (current) redirect(`/org/${encodeURIComponent(current)}${queryStringOf(_searchParams)}`);
        }
        if (result.errorCode === 'FORBIDDEN') {
            const card = await readOrgCard(slug);
            if (card) return <PrivateOrgHeader title={card.title} coverImage={card.coverImage} />;
        }
        if (result.errorCode === 'NOT_FOUND' || result.errorCode === 'FORBIDDEN') {
            notFound();
        }
        throw new Error(`[ProjectDetailPage] ${result.errorCode}: ${result.message}`);
    }

    const { project, capabilities } = result.data;
    // Canonical address: the human-readable slug, under /org for organizations and /projects otherwise.
    const canonicalBase: ProjectRouteBase = project.organization ? '/org' : '/projects';
    if ((project.slug && slug !== project.slug) || base !== canonicalBase) {
        redirect(`${canonicalBase}/${encodeURIComponent(project.slug || project.id)}${queryStringOf(_searchParams)}`);
    }
    const canViewSprints = isProjectTabVisibleToViewer({
        tabId: "sprints",
        isOwnerOrMember: capabilities.isOwner || capabilities.isMember,
        publicTabVisibility: project.publicTabVisibility,
        isOrganization: Boolean(project.organization),
    });
    const initialSprintData = canViewSprints && sprintPromise
        ? sprintPromise.then((sprintResult) => (sprintResult.success ? sprintResult.data : null), () => null)
        : null;

    return (
        <ProjectDashboardClient
            project={project}
            currentUserId={user?.id || null}
            viewerDisplayName={clientViewer.displayName}
            viewerAvatarUrl={clientViewer.avatarUrl}
            isOwner={capabilities.isOwner}
            isMember={capabilities.isMember}
            memberRole={capabilities.memberRole}
            initialSprintData={initialSprintData}
        />
    );
}

export function ProjectRoute({
    base,
    params,
    searchParams,
}: {
    base: ProjectRouteBase;
    params: Promise<{ slug: string }>;
    searchParams: Promise<RouteSearchParams>;
}) {
    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter overscroll-y-contain bg-background"
        >
            <Suspense fallback={<ProjectDetailLoading />}>
                <ResolvedProjectDashboard base={base} params={params} searchParams={searchParams} />
            </Suspense>
        </div>
    );
}
