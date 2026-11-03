import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { WORKSPACE_TAB_LABELS } from '@/lib/copy/terms';
import type { Metadata } from 'next';
import { cache, Suspense } from 'react';
import WorkspaceDashboardClient from '@/components/workspaces/dashboard/WorkspaceDashboardClient';
import { readWorkspaceDetailShell, readWorkspaceSprintDetail } from '@/app/actions/workspace';
import WorkspaceDetailLoading from './loading';
import { PrivateOrgHeader } from '@/components/organizations/PrivateOrgHeader';
import { readPrivateOrgState } from '@/lib/organizations/join';
import { isOrgOnlyWorkspace, readOrgCard, resolveHeldOrgHandle } from '@/lib/organizations/detail';
import { stampLastActiveHere } from '@/lib/organizations/members';
import { copyWorkspacePath } from '@/lib/organizations/assignments';
import { assignmentHref } from '@/lib/organizations/assignment-rules';
import { getViewerIdentityContext, toClientViewer } from '@/lib/server/viewer-context';
import { shareMetadata } from '@/lib/sharing/metadata';
import { readSharePreview } from '@/lib/sharing/read';
import { genericSharePreview, isShareCrawler, shareOrigin } from '@/lib/sharing/presentation';
import { isWorkspaceTabVisibleToViewer } from '@/lib/workspaces/settings-policies';
import { readOrgTabBadgesAction } from '@/app/actions/assignments';
import { readOrgDashboardAction, readOrgWorkspacesAction } from '@/app/actions/org-dashboard';
import { readOrgMembersAction } from '@/app/actions/org-members';
import type { OrgStartedReads } from '@/lib/organizations/started-reads';
import { startTasksBoot } from '@/lib/workspaces/server/tasks-boot';
import { getWorkspaceNodesWithCounts } from '@/app/actions/files/nodes';

const readProjectSprintDetailCached = cache((slugOrId: string, limit?: number, sprintId?: string, taskReference?: string) => readWorkspaceSprintDetail({ slugOrId, limit, sprintId, taskReference }));

export type RouteSearchParams = Record<string, string | string[] | undefined>;
/** Projects live at /workspaces/<slug>; organizations at /org/<handle> (report §24). Same page underneath. */
export type WorkspaceRouteBase = '/workspaces' | '/org';

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
        readWorkspaceDetailShell({ slugOrId }),
    ]);
    return { viewerIdentity, result };
});

export async function generateWorkspaceRouteMetadata({
    params,
    searchParams,
    base = '/workspaces',
}: {
    params: Promise<{ slug: string }>; 
    searchParams: Promise<RouteSearchParams>;
    base?: WorkspaceRouteBase;
}): Promise<Metadata> {
    const [{ slug }, _searchParams] = await Promise.all([params, searchParams]);
    const url = new URL(`${base}/${encodeURIComponent(slug)}`, shareOrigin()).href;
    const preview = await readSharePreview(url);
    const metadata = shareMetadata(preview ?? genericSharePreview({ kind: 'project', identifier: slug, url }, 'unavailable'));

    const requested = firstParam(_searchParams?.tab);
    const tab = requested ?? 'dashboard';
    // Report §17.1: people who can open the workspace get its real title, even when it isn't public (an
    // organization-only workspace). The read below uses their own access; crawlers keep the share preview.
    if (tab && !isShareCrawler((await headers()).get('user-agent'))) {
        const tabTitle = (WORKSPACE_TAB_LABELS as Record<string, string>)[tab];
        if (tabTitle) {
            const { result } = await readProjectRouteShell(slug);
            if (result.success) {
                const { project, capabilities } = result.data;
                const isOwnerOrMember = capabilities.isOwner || capabilities.isMember;
                const canManageSettings = capabilities.isOwner || capabilities.memberRole === 'admin';
                const visible = (tabId: string) => isWorkspaceTabVisibleToViewer({
                    tabId: tabId === 'privacy' ? 'settings' : tabId,
                    isOwnerOrMember,
                    canManageSettings,
                    publicTabVisibility: project.publicTabVisibility,
                    isOrganization: Boolean(project.organization),
                });
                if (visible(tab)) {
                    metadata.title = `${tabTitle} · ${project.title} · NetworkBase`;
                } else if (!requested && project.organization && visible('about')) {
                    // Report §31.2: an organization's visitors land on About, so the title says so.
                    metadata.title = `About · ${project.title} · NetworkBase`;
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
    base: WorkspaceRouteBase;
    params: Promise<{ slug: string }>;
    searchParams: Promise<RouteSearchParams>;
}) {
    const [{ slug }, _searchParams] = await Promise.all([params, searchParams]);
    if (isShareCrawler((await headers()).get('user-agent'))) {
        const preview = await readSharePreview(new URL(`/workspaces/${encodeURIComponent(slug)}`, shareOrigin()).href);
        return <article className="p-6"><h1>{preview?.title ?? 'Workspace on NetworkBase'}</h1><p>{preview?.description ?? 'Open this workspace on NetworkBase.'}</p><a href={preview?.url ?? '/discover'}>Open NetworkBase</a></article>;
    }
    // Old assignment links (report §42.10 problem 11): Tasks, with the exact copy open in its own workspace.
    if (firstParam(_searchParams?.tab) === "assignments") {
        const copyId = firstParam(_searchParams?.copy);
        const copyPath = copyId ? await copyWorkspacePath(copyId) : null;
        redirect(assignmentHref(copyPath ?? `${base}/${encodeURIComponent(slug)}`, copyPath ? copyId : null, firstParam(_searchParams?.view) === "review"));
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
            if (card) return <PrivateOrgHeader orgId={card.id} title={card.title} coverImage={card.coverImage} state={await readPrivateOrgState(card.id, user?.id ?? null)} signedIn={Boolean(user)} />;
            // Report §31.2: an organization-only workspace tells outsiders it isn't available, without details.
            if (await isOrgOnlyWorkspace(slug)) {
                return (
                    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
                        <h1 className="nb-page-title text-foreground">This workspace isn’t available</h1>
                        <p className="text-sm text-muted-foreground">It’s only for the members of its organization.</p>
                        <a href="/discover" className="text-sm text-primary hover:underline">Go to Discover</a>
                    </div>
                );
            }
        }
        if (result.errorCode === 'NOT_FOUND' || result.errorCode === 'FORBIDDEN') {
            notFound();
        }
        throw new Error(`[WorkspaceDetailPage] ${result.errorCode}: ${result.message}`);
    }

    const { project, capabilities } = result.data;
    // Last active here (report §29.4): only inside an organization, and never holding up the page.
    if (user && (project.organization || project.parentOrg)) {
        after(() => stampLastActiveHere(project.id, user.id).catch(() => undefined));
    }
    // Canonical address: the human-readable slug, under /org for organizations and /projects otherwise.
    const canonicalBase: WorkspaceRouteBase = project.organization ? '/org' : '/workspaces';
    if ((project.slug && slug !== project.slug) || base !== canonicalBase) {
        redirect(`${canonicalBase}/${encodeURIComponent(project.slug || project.id)}${queryStringOf(_searchParams)}`);
    }
    const canViewSprints = isWorkspaceTabVisibleToViewer({
        tabId: "sprints",
        isOwnerOrMember: capabilities.isOwner || capabilities.isMember,
        publicTabVisibility: project.publicTabVisibility,
        isOrganization: Boolean(project.organization),
    });
    const initialSprintData = canViewSprints && sprintPromise
        ? sprintPromise.then((sprintResult) => (sprintResult.success ? sprintResult.data : null), () => null)
        : null;
    // A browser runs server actions one at a time, so an organization's open tab starts its first reads here, while the
    // page renders; the tab uses them once (live-fix phase 1, problem 1).
    const orgStarted = project.organization && user && (capabilities.isOwner || capabilities.isMember)
        ? startOrgReads(project.id, selectedTab)
        : null;
    const tasksStarted = selectedTab === 'tasks' && isWorkspaceTabVisibleToViewer({
        tabId: "tasks",
        isOwnerOrMember: capabilities.isOwner || capabilities.isMember,
        publicTabVisibility: project.publicTabVisibility,
        isOrganization: Boolean(project.organization),
    }) ? startTasksBoot(project.id) : null;
    // The Files tab's root folder, the same first page the explorer asks for (100 rows).
    const filesStarted = selectedTab === 'files' && user ? getWorkspaceNodesWithCounts(project.id, null, undefined, 100) : null;
    filesStarted?.catch(() => null);

    return (
        <WorkspaceDashboardClient
            project={project}
            currentUserId={user?.id || null}
            viewerDisplayName={clientViewer.displayName}
            viewerAvatarUrl={clientViewer.avatarUrl}
            isOwner={capabilities.isOwner}
            isMember={capabilities.isMember}
            memberRole={capabilities.memberRole}
            initialSprintData={initialSprintData}
            orgStarted={orgStarted}
            tasksStarted={tasksStarted}
            filesStarted={filesStarted}
        />
    );
}

export function WorkspaceRoute({
    base,
    params,
    searchParams,
}: {
    base: WorkspaceRouteBase;
    params: Promise<{ slug: string }>;
    searchParams: Promise<RouteSearchParams>;
}) {
    return (
        <div
            data-scroll-root="route"
            className="h-full min-h-0 app-scroll app-scroll-y app-scroll-gutter overscroll-y-contain bg-background"
        >
            <Suspense fallback={<WorkspaceDetailLoading />}>
                <ResolvedProjectDashboard base={base} params={params} searchParams={searchParams} />
            </Suspense>
        </div>
    );
}

/** The open tab's read and the tab badges, started without waiting; a failure falls back to the tab's own load. */
function startOrgReads(orgId: string, tab: string): OrgStartedReads {
    const quiet = <T,>(read: Promise<T>) => { read.catch(() => undefined); return read; };
    return {
        badges: quiet(readOrgTabBadgesAction(orgId)),
        ...(tab === 'dashboard' ? { dashboard: quiet(readOrgDashboardAction(orgId)) } : {}),
        ...(tab === 'projects' ? { workspaces: quiet(readOrgWorkspacesAction(orgId)) } : {}),
        ...(tab === 'members' ? { members: quiet(readOrgMembersAction(orgId)) } : {}),
    };
}
