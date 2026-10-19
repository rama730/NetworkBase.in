import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { cache, Suspense } from 'react';
import ProjectDashboardClient from '@/components/projects/dashboard/ProjectDashboardClient';
import { readProjectDetailShell, readProjectSprintDetail } from '@/app/actions/project';
import ProjectDetailLoading from './loading';
import { getViewerIdentityContext, toClientViewer } from '@/lib/server/viewer-context';
import { buildRouteMetadata } from '@/lib/metadata/route-metadata';
import { buildProjectDetailMetadataInput } from '@/lib/projects/project-detail-metadata';
import { isProjectTabVisibleToViewer } from '@/lib/projects/settings-policies';

const readProjectSprintDetailCached = cache((slugOrId: string, limit?: number, sprintId?: string, taskReference?: string) => readProjectSprintDetail({ slugOrId, limit, sprintId, taskReference }));

type RouteSearchParams = Record<string, string | string[] | undefined>;

/** First value of a repeated query param (`?tab=a&tab=b` reads as "a"). */
function firstParam(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] : value;
}

// Metadata and the rendered route share one auth-qualified shell read.
const readProjectRouteShell = cache(async (slugOrId: string) => {
    const viewerIdentity = await getViewerIdentityContext();
    const result = await readProjectDetailShell({ slugOrId });
    return { viewerIdentity, result };
});

export async function generateMetadata({
    params,
    searchParams,
}: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<RouteSearchParams>;
}): Promise<Metadata> {
    const [{ slug }, _searchParams] = await Promise.all([params, searchParams]);
    const { result } = await readProjectRouteShell(slug);
    if (!result.success) {
        return buildRouteMetadata({
            title: "Project unavailable | NetworkBase",
            description: "This project is private or unavailable.",
            path: `/projects/${encodeURIComponent(slug)}`,
        });
    }
    const { project } = result.data;
    const metadataInput = buildProjectDetailMetadataInput(project.slug || slug, project);

    const tab = firstParam(_searchParams?.tab) || "dashboard";
    const tabTitleMap: Record<string, string> = {
        updates: "Project Feed",
        sprints: "Sprints",
        settings: "Settings",
        privacy: "Settings",
        readme: "Docs",
        docs: "Docs",
        files: "Files",
        tasks: "Tasks",
    };
    const tabTitle = tabTitleMap[tab] ?? "";

    if (tabTitle) {
        metadataInput.title = `${tabTitle} | ${project.title} | NetworkBase`;
    }

    return buildRouteMetadata(metadataInput);
}

async function ResolvedProjectDashboard({
    params,
    searchParams
}: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<RouteSearchParams>;
}) {
    const [{ slug }, _searchParams] = await Promise.all([params, searchParams]);
    const selectedTab = firstParam(_searchParams?.tab) || "dashboard";
    const sprintId = firstParam(_searchParams?.sprint) ?? firstParam(_searchParams?.sprintId);
    const viewerIdentity = await getViewerIdentityContext();
    const { user } = viewerIdentity;
    const sprintPromise = selectedTab === "sprints"
        ? readProjectSprintDetailCached(slug, 24, sprintId, firstParam(_searchParams?.task) ?? firstParam(_searchParams?.taskId))
        : null;
    sprintPromise?.catch(() => null);
    const { result } = await readProjectRouteShell(slug);
    const clientViewer = toClientViewer(viewerIdentity);

    if (!result.success) {
        if (result.errorCode === 'NOT_FOUND' || result.errorCode === 'FORBIDDEN') {
            notFound();
        }
        throw new Error(`[ProjectDetailPage] ${result.errorCode}: ${result.message}`);
    }

    const { project, capabilities } = result.data;

    // Ponytail: If accessed via numeric/UUID id, canonically redirect to clean human-readable slug
    if (project.slug && slug !== project.slug) {
        // Repeated params survive as repeated params (`a=1&a=2`), never as a joined "1,2".
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(_searchParams ?? {})) {
            for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
        }
        const queryString = query.toString();
        redirect(`/projects/${encodeURIComponent(project.slug)}${queryString ? `?${queryString}` : ''}`);
    }
    const canViewSprints = isProjectTabVisibleToViewer({
        tabId: "sprints",
        isOwnerOrMember: capabilities.isOwner || capabilities.isMember,
        publicTabVisibility: project.publicTabVisibility,
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
            data-hardening-data="v1"
            data-hardening-files="v1"
            data-hardening-people="v1"
        />
    );
}

export default function ProjectDetailPage({
    params,
    searchParams,
}: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<RouteSearchParams>;
}) {
    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter overscroll-y-contain bg-background"
        >
            <Suspense fallback={<ProjectDetailLoading />}>
                <ResolvedProjectDashboard params={params} searchParams={searchParams} />
            </Suspense>
        </div>
    );
}
