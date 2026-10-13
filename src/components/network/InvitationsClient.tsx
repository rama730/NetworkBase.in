"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Loader2, MapPin, UserPlus, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
    getIncomingApplicationsAction,
    getSentProjectInvitationsAction,
    cancelSentProjectInvitationAction,
    acceptApplicationAction,
    rejectApplicationAction,
    type SentProjectInvitationItem,
} from "@/app/actions/applications";
import { resolveProjectInvitationAction } from "@/app/actions/project/guidance";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { IncomingProjectApplicationRow } from "@/components/network/IncomingProjectApplicationRow";
import { PersonCardLayout } from "@/components/network/PersonCard";
import { useConnectionMutations, usePendingRequests } from "@/hooks/useConnections";
import { useNetworkNotifications } from "@/hooks/useNetworkNotifications";
import { queryKeys } from "@/lib/query-keys";
import { profileHref } from "@/lib/routing/identifiers";

function InvitationCardSkeleton() {
    return (
        <div aria-hidden="true">
            <PersonCardLayout
                avatar={<Skeleton className="size-12 shrink-0 rounded-[8px]" />}
                head={<div className="space-y-2"><Skeleton className="h-4 w-32 rounded-sm" /><Skeleton className="h-3 w-20 rounded-sm" /></div>}
                aside={<div className="flex gap-2"><Skeleton className="size-9 rounded-md" /><Skeleton className="h-9 w-[72px] rounded-md" /></div>}
                body={<><Skeleton className="h-3.5 w-full max-w-64 rounded-sm" /><Skeleton className="h-3 w-32 rounded-sm" /></>}
            />
        </div>
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
    const [processingProject, setProcessingProject] = useState<{ id: string; action: "accept" | "decline" } | null>(null);
    const [processingApplication, setProcessingApplication] = useState<{ id: string; action: "accept" | "decline" } | null>(null);
    const [cancellingProjectId, setCancellingProjectId] = useState<string | null>(null);
    const [isWithdrawAllConfirmOpen, setIsWithdrawAllConfirmOpen] = useState(false);
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
    const { acceptRequest, rejectRequest, undoRejectRequest, cancelRequest, withdrawAllSent } = useConnectionMutations();
    const query = searchQuery.trim().toLocaleLowerCase();

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
            .filter((invitation) => invitation.status === "pending" && invitation.isInvitation);
        if (!query) return incoming;
        return incoming.filter((invitation) => {
            const actor = invitation.actor ?? invitation.applicant;
            return [actor?.fullName, actor?.username, invitation.projectTitle, invitation.roleTitle]
                .some((value) => value?.toLocaleLowerCase().includes(query));
        });
    }, [projectQuery.data?.applications, query]);

    const projectApplications = useMemo(() => {
        const incoming = (projectQuery.data?.applications ?? [])
            .filter((invitation) => invitation.status === "pending" && !invitation.isInvitation);
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
            queryClient.invalidateQueries({ queryKey: queryKeys.workspace.joinRequestsRoot() }),
            queryClient.invalidateQueries({ queryKey: queryKeys.workspace.sentProjectInvitationsRoot() }),
            queryClient.invalidateQueries({ queryKey: ["network", "project-applications"] }),
            queryClient.invalidateQueries({ queryKey: queryKeys.workspace.root() }),
            queryClient.invalidateQueries({ queryKey: queryKeys.notifications.root() }),
            refreshPendingCounts(),
        ]);
    }

    async function acceptConnection(id: string, name: string) {
        try {
            await toast.promise(acceptRequest.mutateAsync(id), {
                loading: "Accepting invitation...",
                success: `You’re now connected with ${name}`,
                error: (error) => error instanceof Error ? error.message : "Failed to accept invitation",
            }).unwrap();
        } catch {
            // Error toast handled above
        } finally {
            void refreshPendingCounts();
        }
    }

    async function declineConnection(id: string) {
        try {
            await toast.promise(rejectRequest.mutateAsync({ id }), {
                loading: "Declining invitation...",
                success: "Invitation declined",
                error: (error) => error instanceof Error ? error.message : "Failed to decline invitation",
            }).unwrap();

            toast.info("Invitation declined", {
                action: {
                    label: "Undo",
                    onClick: () => {
                        void undoRejectRequest.mutateAsync(id).then(() => {
                            toast.success("Decline undone");
                            void refreshPendingCounts();
                        }).catch(() => {
                            toast.error("Could not undo");
                        });
                    },
                },
            });
        } catch {
            // Error toast handled above
        } finally {
            void refreshPendingCounts();
        }
    }

    async function handleCancelConnection(id: string, name?: string) {
        await toast.promise(cancelRequest.mutateAsync(id), {
            loading: "Cancelling connection request...",
            success: name ? `Cancelled request to ${name}` : "Connection request cancelled",
            error: (error) => error instanceof Error ? error.message : "Failed to cancel request",
        }).unwrap().catch(() => undefined);
        void refreshPendingCounts();
    }

    async function handleWithdrawAllSent() {
        try {
            await toast.promise(withdrawAllSent.mutateAsync(), {
                loading: "Cancelling all sent requests...",
                success: "All sent requests cancelled",
                error: (error) => error instanceof Error ? error.message : "Failed to cancel sent requests",
            }).unwrap();
        } catch {
            // Handled
        } finally {
            setIsWithdrawAllConfirmOpen(false);
            void refreshPendingCounts();
        }
    }

    async function handleCancelSentProjectInvitation(item: SentProjectInvitationItem) {
        setCancellingProjectId(item.id);
        try {
            await toast.promise(
                cancelSentProjectInvitationAction({
                    invitationId: item.invitationId,
                }).then((res) => {
                    if (!res.success) throw new Error(res.error || "Failed to cancel project invitation");
                    return res;
                }),
                {
                    loading: "Cancelling project invitation...",
                    success: "Project invitation cancelled",
                    error: (error) => error instanceof Error ? error.message : "Failed to cancel project invitation",
                }
            ).unwrap();

            // Only after it really cancelled: a failure keeps the row (the toast says why).
            queryClient.setQueryData<SentProjectInvitationItem[]>(
                queryKeys.workspace.sentProjectInvitations(50),
                (prev) => (prev ? prev.filter((p) => p.id !== item.id) : [])
            );

            await refreshInvitationSurfaces();
        } catch {
            // The toast already says what went wrong.
        } finally {
            setCancellingProjectId(null);
        }
    }

    async function resolveProjectInvitation(id: string, action: "accept" | "decline") {
        setProcessingProject({ id, action });
        try {
            const request = resolveProjectInvitationAction({ invitationId: id, action }).then((result) => {
                if (!result.success) throw new Error(result.error || "Failed to update project invitation");
                return result;
            });
            await toast.promise(request, {
                loading: action === "accept" ? "Accepting project invitation..." : "Declining project invitation...",
                success: action === "accept" ? "Project invitation accepted" : "Project invitation declined",
                error: (error) => error instanceof Error ? error.message : "Failed to update project invitation",
            }).unwrap();
            await refreshInvitationSurfaces();
        } catch {
            // The toast already says what went wrong.
        } finally {
            setProcessingProject(null);
        }
    }

    async function handleResolveApplication(id: string, action: "accept" | "decline") {
        setProcessingApplication({ id, action });
        try {
            const request = (
                action === "accept"
                    ? acceptApplicationAction(id)
                    : rejectApplicationAction(id)
            ).then((result) => {
                if (!result.success) throw new Error(result.error || `Failed to ${action} application`);
                return result;
            });
            await toast.promise(request, {
                loading: action === "accept" ? "Accepting application..." : "Declining application...",
                success: action === "accept" ? "Application accepted" : "Application declined",
                error: (error) => error instanceof Error ? error.message : `Failed to ${action} application`,
            }).unwrap();
            await refreshInvitationSurfaces();
        } catch {
            // Handled
        } finally {
            setProcessingApplication(null);
        }
    }

    const isInitialLoading = (connectionQuery.isLoading && !connectionQuery.data)
        || (projectQuery.isLoading && !projectQuery.data)
        || (sentProjectQuery.isLoading && !sentProjectQuery.data);
    const hasOtherSections = Boolean(
        projectInvitations.length
        || projectApplications.length
        || sentConnectionRequests.length
        || sentProjectInvitations.length
    );

    const hasInvitations = connectionInvitations.length > 0
        || projectInvitations.length > 0
        || projectApplications.length > 0
        || sentConnectionRequests.length > 0
        || sentProjectInvitations.length > 0;

    if (isInitialLoading) {
        return (
            <div className={INVITATION_GRID} aria-label="Loading invitations" role="status">
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
        <div className="grid gap-6">
            {connectionInvitations.length ? (
                <section aria-labelledby="connection-invitations-heading">
                    <h2
                        id="connection-invitations-heading"
                        className={hasOtherSections ? "nb-micro mb-3" : "sr-only"}
                    >
                        Connection invitations
                    </h2>
                    <div className={INVITATION_GRID}>
                        {connectionInvitations.map((invitation) => {
                            const profile = { id: invitation.requesterId, username: invitation.requesterUsername, fullName: invitation.requesterFullName, avatarUrl: invitation.requesterAvatarUrl };
                            const displayName = invitation.requesterFullName || invitation.requesterUsername || "NetworkBase member";
                            const isAccepting = acceptRequest.isPending && acceptRequest.variables === invitation.id;
                            const isDeclining = rejectRequest.isPending && rejectRequest.variables?.id === invitation.id;
                            const isProcessing = isAccepting || isDeclining;

                            return (
                                <PersonCardLayout
                                    key={invitation.id}
                                    avatar={<Link href={profileHref(profile)} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><UserAvatar identity={profile} size={48} fallbackClassName="text-base font-semibold" /></Link>}
                                    head={<InvitationName href={profileHref(profile)} name={displayName} />}
                                    location={locationLine(invitation.requesterLocation)}
                                    headline={headlineLine(invitation.requesterHeadline)}
                                    aside={
                                        <InvitationActions
                                            name={displayName}
                                            busy={isProcessing}
                                            accepting={isAccepting}
                                            declining={isDeclining}
                                            onAccept={() => void acceptConnection(invitation.id, displayName.split(" ")[0] || displayName)}
                                            onDecline={() => void declineConnection(invitation.id)}
                                        />
                                    }
                                    body={invitation.message?.trim() ? <p className="nb-meta truncate" title={invitation.message}>{invitation.message}</p> : null}
                                />
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {projectInvitations.length ? (
                <section aria-labelledby="project-invitations-heading">
                    <h2 id="project-invitations-heading" className="nb-micro mb-3">Project invitations</h2>
                    <div className={INVITATION_GRID}>
                        {projectInvitations.map((invitation) => {
                            const actor = invitation.actor ?? invitation.applicant;
                            const displayName = actor?.fullName || actor?.username || "NetworkBase member";
                            const busy = processingProject?.id === invitation.id;
                            return (
                                <PersonCardLayout
                                    key={invitation.id}
                                    avatar={<Link href={profileHref(actor)} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><UserAvatar identity={actor} size={48} fallbackClassName="text-base font-semibold" /></Link>}
                                    head={<InvitationName href={profileHref(actor)} name={displayName} />}
                                    meta={[<RoleLine key="role" role={invitation.roleTitle} />]}
                                    headline={<p className="nb-body truncate text-muted-foreground">Invited you to join <Link href={`/projects/${invitation.projectSlug || invitation.projectId}`} className="font-medium text-foreground hover:text-primary">{invitation.projectTitle}</Link></p>}
                                    aside={
                                        <InvitationActions
                                            name={displayName}
                                            busy={busy}
                                            accepting={busy && processingProject.action === "accept"}
                                            declining={busy && processingProject.action === "decline"}
                                            onAccept={() => void resolveProjectInvitation(invitation.id, "accept")}
                                            onDecline={() => void resolveProjectInvitation(invitation.id, "decline")}
                                        />
                                    }
                                    body={<p><span className="nb-status" data-status="active">Project invitation</span></p>}
                                />
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {projectApplications.length ? (
                <section aria-labelledby="project-applications-heading">
                    <h2 id="project-applications-heading" className="nb-micro mb-3">Project applications</h2>
                    <div className="grid grid-cols-1 gap-3">
                        {projectApplications.map((app) => (
                            <IncomingProjectApplicationRow
                                key={app.id}
                                app={app}
                                busy={processingApplication?.id === app.id}
                                isAccepting={processingApplication?.id === app.id && processingApplication.action === "accept"}
                                isRejecting={processingApplication?.id === app.id && processingApplication.action === "decline"}
                                onAccept={() => void handleResolveApplication(app.id, "accept")}
                                onReject={() => void handleResolveApplication(app.id, "decline")}
                            />
                        ))}
                    </div>
                </section>
            ) : null}

            {sentProjectInvitations.length ? (
                <section aria-labelledby="sent-project-invitations-heading">
                    <h2 id="sent-project-invitations-heading" className="nb-micro mb-3">Sent project invitations</h2>
                    <div className={INVITATION_GRID}>
                        {sentProjectInvitations.map((invitation) => {
                            const candidate = invitation.candidate;
                            const displayName = candidate.fullName || candidate.username || "NetworkBase member";

                            return (
                                <PersonCardLayout
                                    key={invitation.id}
                                    avatar={<Link href={profileHref(candidate)} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><UserAvatar identity={candidate} size={48} fallbackClassName="text-base font-semibold" /></Link>}
                                    head={<InvitationName href={profileHref(candidate)} name={displayName} />}
                                    meta={[<RoleLine key="role" role={invitation.roleTitle} />]}
                                    headline={<p className="nb-body truncate text-muted-foreground">Invited to join <Link href={`/projects/${invitation.projectSlug || invitation.projectId}`} className="font-medium text-foreground hover:text-primary">{invitation.projectTitle}</Link></p>}
                                    aside={
                                        <CancelButton
                                            label={`Cancel project invitation to ${displayName}`}
                                            busy={cancellingProjectId === invitation.id}
                                            onClick={() => void handleCancelSentProjectInvitation(invitation)}
                                        />
                                    }
                                    body={<PendingResponse />}
                                />
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
                                onClick={() => setIsWithdrawAllConfirmOpen(true)}
                                disabled={withdrawAllSent.isPending}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                            >
                                {withdrawAllSent.isPending ? "Cancelling all..." : "Cancel all"}
                            </button>
                        ) : null}
                    </div>
                    <div className={INVITATION_GRID}>
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
                                <PersonCardLayout
                                    key={request.id}
                                    avatar={<Link href={profileHref(profile)} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><UserAvatar identity={profile} size={48} fallbackClassName="text-base font-semibold" /></Link>}
                                    head={<InvitationName href={profileHref(profile)} name={displayName} />}
                                    location={locationLine(request.addresseeLocation)}
                                    headline={headlineLine(request.addresseeHeadline)}
                                    aside={
                                        <CancelButton
                                            label={`Cancel connection request to ${displayName}`}
                                            busy={isCancelling}
                                            onClick={() => void handleCancelConnection(request.id, displayName)}
                                        />
                                    }
                                    body={<PendingResponse />}
                                />
                            );
                        })}
                    </div>
                </section>
            ) : null}

            <ConfirmDialog
                open={isWithdrawAllConfirmOpen}
                onOpenChange={setIsWithdrawAllConfirmOpen}
                title="Cancel all sent requests?"
                description="This will withdraw all pending connection requests you have sent."
                confirmLabel="Cancel all requests"
                variant="destructive"
                loading={withdrawAllSent.isPending}
                onConfirm={() => void handleWithdrawAllSent()}
            />
        </div>
    );
}

/** Same grid as the Suggested / Connections tabs. */
const INVITATION_GRID = "grid grid-cols-1 gap-[14px] sm:grid-cols-2";

function InvitationName({ href, name }: { href: string; name: string }) {
    return (
        <Link href={href} className="block min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <h3 className="nb-person-name min-w-0 truncate text-foreground" title={name}>{name}</h3>
        </Link>
    );
}

// Plain helpers (not components) so an absent value is null and the layout's location-or-headline slot sees it.
function locationLine(location?: string | null) {
    if (!location?.trim()) return null;
    return (
        <p className="nb-meta mt-1 flex min-w-0 items-center gap-1" title={location}>
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{location}</span>
        </p>
    );
}

function headlineLine(headline?: string | null) {
    const text = headline?.trim();
    return text ? <p className="nb-body truncate text-muted-foreground" title={text}>{text}</p> : null;
}

function RoleLine({ role }: { role: string }) {
    return <p className="nb-meta mt-1 truncate" title={role}>Role · {role}</p>;
}

function PendingResponse() {
    return (
        <p className="nb-meta flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-3 shrink-0" aria-hidden="true" />
            <span>Pending response</span>
        </p>
    );
}

// Accept reads like Connect on the person card; Decline is a compact icon button beside it.
function InvitationActions({ name, busy, accepting, declining, onAccept, onDecline }: {
    name: string;
    busy: boolean;
    accepting: boolean;
    declining: boolean;
    onAccept: () => void;
    onDecline: () => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={onDecline}
                disabled={busy}
                title="Decline"
                aria-label={`Decline invitation from ${name}`}
                className="nb-touch-target inline-flex size-[var(--ui-control-height)] shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
                {declining ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <X className="size-4" aria-hidden="true" />}
            </button>
            <button type="button" onClick={onAccept} disabled={busy} className="nb-person-connect" aria-label={`Accept invitation from ${name}`}>
                {accepting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                Accept
            </button>
        </div>
    );
}

function CancelButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={busy}
            aria-label={label}
            className="nb-touch-target inline-flex h-[var(--ui-control-height)] shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm max-md:text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
            {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
            Cancel
        </button>
    );
}
