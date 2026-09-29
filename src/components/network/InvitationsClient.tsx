"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Loader2, UserPlus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";

import {
    getIncomingApplicationsAction,
    getSentProjectInvitationsAction,
    cancelSentProjectInvitationAction,
    type SentProjectInvitationItem,
} from "@/app/actions/applications";
import { resolveMessageWorkflowActionV2 } from "@/app/actions/messaging/collaboration";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useConnectionMutations, usePendingRequests } from "@/hooks/useConnections";
import { useNetworkNotifications } from "@/hooks/useNetworkNotifications";
import { queryKeys } from "@/lib/query-keys";
import { profileHref } from "@/lib/routing/identifiers";

function InvitationCardSkeleton() {
    return (
        <article className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-3.5" aria-hidden="true">
            <Skeleton className="size-[54px] shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-40 rounded-sm" />
                <Skeleton className="h-3.5 w-64 rounded-sm" />
                <Skeleton className="h-3 w-32 rounded-sm" />
            </div>
            <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                <Skeleton className="h-9 w-20 rounded-md" />
                <Skeleton className="h-9 w-20 rounded-md" />
            </div>
        </article>
    );
}

export default function InvitationsClient({
    initialUser,
    searchQuery,
}: {
    initialUser: { id?: string | null } | null;
    searchQuery: string;
}) {
    const isAuthenticated = Boolean(initialUser?.id);
    const [debouncedSearch] = useDebounce(searchQuery, 300);
    const [processingProject, setProcessingProject] = useState<{ id: string; action: "accept" | "decline" } | null>(null);
    const [cancellingProjectId, setCancellingProjectId] = useState<string | null>(null);
    const queryClient = useQueryClient();
    const { refresh: refreshPendingCounts } = useNetworkNotifications();
    const connectionQuery = usePendingRequests(50, isAuthenticated, { includeSent: true });
    const projectQuery = useQuery({
        queryKey: queryKeys.workspace.joinRequests(50),
        enabled: isAuthenticated,
        staleTime: 30_000,
        queryFn: async () => {
            const result = await getIncomingApplicationsAction({ limit: 50 });
            if (!result.success) throw new Error(result.error || "Failed to load project invitations");
            return result;
        },
    });
    const sentProjectQuery = useQuery({
        queryKey: queryKeys.workspace.sentProjectInvitations(50),
        enabled: isAuthenticated,
        staleTime: 30_000,
        queryFn: async () => {
            const result = await getSentProjectInvitationsAction({ limit: 50 });
            if (!result.success) throw new Error(result.error || "Failed to load sent project invitations");
            return result.invitations;
        },
    });
    const { acceptRequest, rejectRequest, sendRequest, cancelRequest, withdrawAllSent } = useConnectionMutations();
    const query = debouncedSearch.trim().toLocaleLowerCase();

    const connectionInvitations = useMemo(() => {
        const incoming = connectionQuery.data?.incoming ?? [];
        if (!query) return incoming;
        return incoming.filter((invitation) => [
            invitation.requesterFullName,
            invitation.requesterUsername,
            invitation.requesterHeadline,
            invitation.requesterLocation,
            ...(invitation.requesterSkills ?? []),
        ].some((value) => value?.toLocaleLowerCase().includes(query)));
    }, [connectionQuery.data?.incoming, query]);

    const sentConnectionRequests = useMemo(() => {
        const sent = connectionQuery.data?.sent ?? [];
        if (!query) return sent;
        return sent.filter((invitation) => [
            invitation.addresseeFullName,
            invitation.addresseeUsername,
            invitation.addresseeHeadline,
            invitation.addresseeLocation,
            ...(invitation.addresseeSkills ?? []),
        ].some((value) => value?.toLocaleLowerCase().includes(query)));
    }, [connectionQuery.data?.sent, query]);

    const projectInvitations = useMemo(() => {
        const incoming = (projectQuery.data?.applications ?? [])
            .filter((invitation) => invitation.status === "pending" && invitation.isWorkflowItem);
        if (!query) return incoming;
        return incoming.filter((invitation) => {
            const actor = invitation.actor ?? invitation.applicant;
            return [actor?.fullName, actor?.username, invitation.projectTitle, invitation.roleTitle]
                .some((value) => value?.toLocaleLowerCase().includes(query));
        });
    }, [projectQuery.data?.applications, query]);

    const sentProjectInvitations = useMemo(() => {
        const sent = sentProjectQuery.data ?? [];
        if (!query) return sent;
        return sent.filter((invitation) => [
            invitation.candidate.fullName,
            invitation.candidate.username,
            invitation.candidate.headline,
            invitation.projectTitle,
            invitation.roleTitle,
            invitation.note,
        ].some((value) => value?.toLocaleLowerCase().includes(query)));
    }, [sentProjectQuery.data, query]);

    async function refreshInvitationSurfaces() {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.workspace.joinRequests(50) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.workspace.sentProjectInvitations(50) }),
            queryClient.invalidateQueries({ queryKey: ["network", "project-applications"] }),
            queryClient.invalidateQueries({ queryKey: queryKeys.workspace.root() }),
            queryClient.invalidateQueries({ queryKey: queryKeys.notifications.root() }),
            refreshPendingCounts(),
        ]);
    }

    async function acceptConnection(id: string, name: string) {
        await toast.promise(acceptRequest.mutateAsync(id), {
            loading: "Accepting invitation...",
            success: `You’re now connected with ${name}`,
            error: (error) => error instanceof Error ? error.message : "Failed to accept invitation",
        });
    }

    async function declineConnection(id: string) {
        await toast.promise(rejectRequest.mutateAsync({ id }), {
            loading: "Declining invitation...",
            success: "Invitation declined",
            error: (error) => error instanceof Error ? error.message : "Failed to decline invitation",
        });
    }

    async function handleCancelConnection(id: string, name?: string) {
        await toast.promise(cancelRequest.mutateAsync(id), {
            loading: "Cancelling connection request...",
            success: name ? `Cancelled request to ${name}` : "Connection request cancelled",
            error: (error) => error instanceof Error ? error.message : "Failed to cancel request",
        });
    }

    async function handleWithdrawAllSent() {
        await withdrawAllSent.mutateAsync();
    }

    async function handleCancelSentProjectInvitation(item: SentProjectInvitationItem) {
        setCancellingProjectId(item.id);
        try {
            await toast.promise(
                cancelSentProjectInvitationAction({
                    invitationId: item.invitationId,
                    workflowItemId: item.workflowItemId,
                }).then((res) => {
                    if (!res.success) throw new Error(res.error || "Failed to cancel project invitation");
                    return res;
                }),
                {
                    loading: "Cancelling project invitation...",
                    success: "Project invitation cancelled",
                    error: (error) => error instanceof Error ? error.message : "Failed to cancel project invitation",
                }
            );

            queryClient.setQueryData<SentProjectInvitationItem[]>(
                queryKeys.workspace.sentProjectInvitations(50),
                (prev) => (prev ? prev.filter((p) => p.id !== item.id) : [])
            );

            await refreshInvitationSurfaces();
        } finally {
            setCancellingProjectId(null);
        }
    }

    async function resolveProjectInvitation(id: string, action: "accept" | "decline") {
        setProcessingProject({ id, action });
        try {
            const request = resolveMessageWorkflowActionV2({ workflowItemId: id, action }).then((result) => {
                if (!result.success) throw new Error(result.error || "Failed to update project invitation");
                return result;
            });
            await toast.promise(request, {
                loading: action === "accept" ? "Accepting project invitation..." : "Declining project invitation...",
                success: action === "accept" ? "Project invitation accepted" : "Project invitation declined",
                error: (error) => error instanceof Error ? error.message : "Failed to update project invitation",
            });
            await refreshInvitationSurfaces();
        } finally {
            setProcessingProject(null);
        }
    }

    const isInitialLoading = (connectionQuery.isLoading && !connectionQuery.data)
        || (projectQuery.isLoading && !projectQuery.data)
        || (sentProjectQuery.isLoading && !sentProjectQuery.data);
    const hasInvitations = connectionInvitations.length > 0
        || projectInvitations.length > 0
        || sentConnectionRequests.length > 0
        || sentProjectInvitations.length > 0;

    if (isInitialLoading) {
        return (
            <div className="grid max-w-[620px] gap-3" aria-label="Loading invitations" role="status">
                <span className="sr-only">Loading invitations…</span>
                {[1, 2].map((item) => <InvitationCardSkeleton key={item} />)}
            </div>
        );
    }

    if (!hasInvitations && (connectionQuery.error || projectQuery.error || sentProjectQuery.error)) {
        return (
            <div className="max-w-[620px] rounded-lg border border-border bg-card p-8 text-center">
                <h2 className="nb-card-title text-foreground">Invitations could not be loaded.</h2>
                <p className="mt-1 text-sm max-md:text-[13px] text-muted-foreground">Please try again.</p>
                <button type="button" onClick={() => void Promise.all([connectionQuery.refetch(), projectQuery.refetch(), sentProjectQuery.refetch()])} className="mt-4 text-sm max-md:text-[13px] font-medium text-primary hover:underline">Retry</button>
            </div>
        );
    }

    if (!hasInvitations) {
        return (
            <div className="max-w-[620px]">
                <EmptyState
                    icon={UserPlus}
                    title={query ? "No invitations match your search." : "No pending invitations."}
                    description={query ? "Try a different name, skill, role, or project." : "Connection and project invitations will appear here."}
                />
            </div>
        );
    }

    return (
        <div className="grid max-w-[620px] gap-6">
            {connectionInvitations.length ? (
                <section aria-labelledby="connection-invitations-heading">
                    {projectInvitations.length || sentConnectionRequests.length || sentProjectInvitations.length ? (
                        <h2 id="connection-invitations-heading" className="nb-micro mb-3">Connection invitations</h2>
                    ) : null}
                    <div className="grid gap-3">
                        {connectionInvitations.map((invitation) => {
                            const profile = { id: invitation.requesterId, username: invitation.requesterUsername, fullName: invitation.requesterFullName, avatarUrl: invitation.requesterAvatarUrl };
                            const displayName = invitation.requesterFullName || invitation.requesterUsername || "NetworkBase member";
                            const isAccepting = acceptRequest.isPending && acceptRequest.variables === invitation.id;
                            const isDeclining = rejectRequest.isPending && rejectRequest.variables?.id === invitation.id;
                            const isProcessing = isAccepting || isDeclining;

                            return (
                                <article key={invitation.id} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-3.5">
                                    <Link href={profileHref(profile)} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <UserAvatar identity={profile} size={54} fallbackClassName="text-lg font-semibold" />
                                    </Link>
                                    <Link href={profileHref(profile)} className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="nb-card-title text-foreground">{displayName}</h3>
                                            <span className="inline-flex rounded-sm border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">Invited you</span>
                                        </div>
                                        {invitation.requesterHeadline ? <p className="mt-1 truncate text-sm max-md:text-[13px] text-muted-foreground">{invitation.requesterHeadline}</p> : null}
                                        <p className="nb-meta mt-1.5 truncate">{invitation.message || "Wants to connect and collaborate with you."}</p>
                                    </Link>
                                    <InvitationActions
                                        busy={isProcessing}
                                        accepting={isAccepting}
                                        declining={isDeclining}
                                        onAccept={() => void acceptConnection(invitation.id, displayName.split(" ")[0] || displayName)}
                                        onDecline={() => void declineConnection(invitation.id)}
                                    />
                                </article>
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {projectInvitations.length ? (
                <section aria-labelledby="project-invitations-heading">
                    <h2 id="project-invitations-heading" className="nb-micro mb-3">Project invitations</h2>
                    <div className="grid gap-3">
                        {projectInvitations.map((invitation) => {
                            const actor = invitation.actor ?? invitation.applicant;
                            const displayName = actor?.fullName || actor?.username || "NetworkBase member";
                            const busy = processingProject?.id === invitation.id;
                            return (
                                <article key={invitation.id} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-3.5">
                                    <Link href={profileHref(actor)} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <UserAvatar identity={actor} size={54} fallbackClassName="text-lg font-semibold" />
                                    </Link>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Link href={profileHref(actor)} className="nb-card-title text-foreground hover:text-primary">{displayName}</Link>
                                            <span className="inline-flex rounded-sm border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">Project invitation</span>
                                        </div>
                                        <p className="mt-1 text-sm max-md:text-[13px] text-muted-foreground">Invited you to join <Link href={`/projects/${invitation.projectSlug || invitation.projectId}`} className="font-medium text-foreground hover:text-primary">{invitation.projectTitle}</Link></p>
                                        <p className="nb-meta mt-1.5">Role · {invitation.roleTitle}</p>
                                    </div>
                                    <InvitationActions
                                        busy={busy}
                                        accepting={busy && processingProject.action === "accept"}
                                        declining={busy && processingProject.action === "decline"}
                                        onAccept={() => void resolveProjectInvitation(invitation.id, "accept")}
                                        onDecline={() => void resolveProjectInvitation(invitation.id, "decline")}
                                    />
                                </article>
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {sentProjectInvitations.length ? (
                <section aria-labelledby="sent-project-invitations-heading">
                    <h2 id="sent-project-invitations-heading" className="nb-micro mb-3">Sent project invitations</h2>
                    <div className="grid gap-3">
                        {sentProjectInvitations.map((invitation) => {
                            const candidate = invitation.candidate;
                            const displayName = candidate.fullName || candidate.username || "NetworkBase member";
                            const isCancelling = cancellingProjectId === invitation.id;

                            return (
                                <article key={invitation.id} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-3.5">
                                    <Link href={profileHref(candidate)} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <UserAvatar identity={candidate} size={54} fallbackClassName="text-lg font-semibold" />
                                    </Link>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Link href={profileHref(candidate)} className="nb-card-title text-foreground hover:text-primary">{displayName}</Link>
                                        </div>
                                        <p className="mt-1 text-sm max-md:text-[13px] text-muted-foreground">
                                            Invited to join{" "}
                                            <Link href={`/projects/${invitation.projectSlug || invitation.projectId}`} className="font-medium text-foreground hover:text-primary">
                                                {invitation.projectTitle}
                                            </Link>
                                        </p>
                                        <div className="nb-meta mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                                            <span>Role · {invitation.roleTitle}</span>
                                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                                                <Clock className="size-3 shrink-0" aria-hidden="true" />
                                                Pending response
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                                        <button
                                            type="button"
                                            onClick={() => void handleCancelSentProjectInvitation(invitation)}
                                            disabled={isCancelling}
                                            className="nb-touch-target inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-3 text-sm max-md:text-[13px] font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                                        >
                                            {isCancelling ? <Loader2 className="size-4 animate-spin text-muted-foreground mr-1.5" aria-hidden="true" /> : null}
                                            Cancel invitation
                                        </button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {sentConnectionRequests.length ? (
                <section aria-labelledby="sent-requests-heading">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 id="sent-requests-heading" className="nb-micro">Sent connection requests</h2>
                        {sentConnectionRequests.length > 1 ? (
                            <button
                                type="button"
                                onClick={() => void handleWithdrawAllSent()}
                                disabled={withdrawAllSent.isPending}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                            >
                                {withdrawAllSent.isPending ? "Cancelling all..." : "Cancel all"}
                            </button>
                        ) : null}
                    </div>
                    <div className="grid gap-3">
                        {sentConnectionRequests.map((request) => {
                            const profile = {
                                id: request.addresseeId,
                                username: request.addresseeUsername,
                                fullName: request.addresseeFullName,
                                avatarUrl: request.addresseeAvatarUrl,
                            };
                            const displayName = request.addresseeFullName || request.addresseeUsername || "NetworkBase member";
                            const isCancelling = cancelRequest.isPending && (
                                cancelRequest.variables === request.id || cancelRequest.variables === request.addresseeId
                            );

                            return (
                                <article key={request.id} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-3.5">
                                    <Link href={profileHref(profile)} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <UserAvatar identity={profile} size={54} fallbackClassName="text-lg font-semibold" />
                                    </Link>
                                    <Link href={profileHref(profile)} className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="nb-card-title text-foreground">{displayName}</h3>
                                        </div>
                                        {request.addresseeHeadline ? <p className="mt-1 truncate text-sm max-md:text-[13px] text-muted-foreground">{request.addresseeHeadline}</p> : null}
                                        <p className="nb-meta mt-1.5 flex items-center gap-1.5 text-muted-foreground">
                                            <Clock className="size-3 shrink-0" aria-hidden="true" />
                                            <span>Pending response</span>
                                        </p>
                                    </Link>
                                    <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                                        <button
                                            type="button"
                                            onClick={() => void handleCancelConnection(request.id, displayName)}
                                            disabled={isCancelling}
                                            className="nb-touch-target inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-3 text-sm max-md:text-[13px] font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                                        >
                                            {isCancelling ? <Loader2 className="size-4 animate-spin text-muted-foreground mr-1.5" aria-hidden="true" /> : null}
                                            Cancel request
                                        </button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </section>
            ) : null}
        </div>
    );
}

function InvitationActions({ busy, accepting, declining, onAccept, onDecline }: {
    busy: boolean;
    accepting: boolean;
    declining: boolean;
    onAccept: () => void;
    onDecline: () => void;
}) {
    return (
        <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
            <button type="button" onClick={onDecline} disabled={busy} className="nb-touch-target inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-3 text-sm max-md:text-[13px] font-medium text-foreground hover:bg-muted disabled:opacity-50">
                {declining ? <Loader2 className="size-4 animate-spin" aria-label="Declining" /> : "Decline"}
            </button>
            <button type="button" onClick={onAccept} disabled={busy} className="nb-touch-target inline-flex h-9 items-center justify-center rounded-md border border-primary bg-primary px-3 text-sm max-md:text-[13px] font-medium text-primary-foreground transition-[background-color,border-color,color] duration-150 ease-in-out hover:border-[var(--primary-hover)] hover:bg-[var(--primary-hover)] active:border-[var(--primary-active)] active:bg-[var(--primary-active)] disabled:opacity-50">
                {accepting ? <Loader2 className="size-4 animate-spin" aria-label="Accepting" /> : "Accept"}
            </button>
        </div>
    );
}
