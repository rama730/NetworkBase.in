"use client";

import { OrgRequestsSection, useOrgRequests } from "@/components/organizations/OrgRequestsSection";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { toast, feedbackError } from "@/lib/feedback";

import {
    cancelSentProjectInvitationAction,
    acceptApplicationAction,
    rejectApplicationAction,
    reopenApplicationAction,
    withdrawApplicationAction,
    type SentProjectInvitationItem,
} from "@/app/actions/applications";
import WithdrawApplicationDialog from "@/components/projects/dashboard/WithdrawApplicationDialog";
import { SentApplicationMenu } from "./SentApplicationMenu";
import { ApplicationReview, DecidedApplicationMenu } from "./ApplicationReview";
import type { DecisionInput } from "@/components/applications/DecisionDialog";
import { resolveProjectInvitationAction } from "@/app/actions/project/guidance";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { PersonCardContent } from "./PersonCardContent";
import { PersonCardSkeleton } from "./PersonCardSkeleton";
import { PersonCardReview, PersonCardCancelMenu } from "./PersonCardReview";
import { personCardName, personRequestDate } from "@/lib/network/person-card";
import { useConnectionMutations } from "@/hooks/useConnections";
import { useNetworkNotifications } from "@/hooks/useNetworkNotifications";
import { readNetworkInvitationsAction, type NetworkInvitation } from "@/app/actions/network-invitations";
import {
    normalizeNetworkQuery,
    activeNetworkFilters,
    type NetworkBrowseQuery,
} from "@/lib/network/browse-query";
import {
    MAX_RETAINED_PERSON_QUERY_PAGES,
    boundPersonCardItems,
} from "@/lib/network/person-card-bounds";
import { queryKeys } from "@/lib/query-keys";
import { profileHref } from "@/lib/routing/identifiers";

function InvitationCardSkeleton() {
    return <PersonCardSkeleton />;
}

export default function InvitationsClient({
    initialUser,
    searchQuery,
    query: inputQuery,
    onReset,
    onReady,
    onLoadingChange,
}: {
    initialUser: { id?: string | null } | null;
    searchQuery: string;
    query?: NetworkBrowseQuery;
    onReset?: () => void;
    onReady?: () => void;
    onLoadingChange?: (loading: boolean) => void;
}) {
    const isAuthenticated = Boolean(initialUser?.id);
    const [, setProcessingProject] = useState<{
        id: string;
        action: "accept" | "decline";
    } | null>(null);
    const [, setProcessingApplication] = useState<{
        id: string;
        action: "accept" | "decline";
    } | null>(null);
    const [cancellingProjectId, setCancellingProjectId] = useState<
        string | null
    >(null);
    const [isWithdrawAllConfirmOpen, setIsWithdrawAllConfirmOpen] =
        useState(false);
    const [withdrawingApplication, setWithdrawingApplication] =
        useState<NetworkInvitation | null>(null);
    const withdrawReturn = useRef<HTMLElement | null>(null);
    const queryClient = useQueryClient();
    const { refresh: refreshPendingCounts } = useNetworkNotifications();
    const browse =
        inputQuery ?? normalizeNetworkQuery("invitations", { q: searchQuery });
    const {
        acceptRequest,
        rejectRequest,
        undoRejectRequest,
        cancelRequest,
        withdrawAllSent,
    } = useConnectionMutations();
    const invitationsQuery = useInfiniteQuery({
        queryKey: queryKeys.connections.invitationBrowse(
            initialUser?.id ?? "",
            browse,
        ),
        enabled: isAuthenticated,
        initialPageParam: undefined as string | undefined,
        maxPages: MAX_RETAINED_PERSON_QUERY_PAGES,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        queryFn: async ({ pageParam }) => {
            const result = await readNetworkInvitationsAction({
                q: browse.q,
                sort: browse.sort === "oldest" ? "oldest" : "recent",
                direction: browse.direction,
                kind: browse.kind,
                cursor: pageParam,
                limit: 30,
            });
            if (!result.success) throw new Error(result.error);
            return result;
        },
        getNextPageParam: (page) => page.nextCursor ?? undefined,
        placeholderData: keepPreviousData,
    });
    const query = browse.q;
    const filtered = Boolean(query || activeNetworkFilters(browse));
    const entries = useMemo(
        () =>
            boundPersonCardItems(
                invitationsQuery.data?.pages.flatMap((page) => page.items) ??
                    [],
            ),
        [invitationsQuery.data],
    );
    const connectionInvitations = entries
        .filter(
            (item) =>
                item.source === "connection" && item.direction === "received",
        )
        .map((item) => ({
            id: item.id,
            requesterId: item.person.id,
            requesterUsername: item.person.username,
            requesterFullName: item.person.fullName,
            requesterAvatarUrl: item.person.avatarUrl,
            requesterHeadline: item.person.headline,
            requesterLocation: item.person.location,
            requesterSkills: item.person.skills,
            personCard: item.person,
            message: item.note,
            createdAt: item.createdAt,
        }));
    const sentConnectionRequests = entries
        .filter(
            (item) => item.source === "connection" && item.direction === "sent",
        )
        .map((item) => ({
            id: item.id,
            addresseeId: item.person.id,
            addresseeUsername: item.person.username,
            addresseeFullName: item.person.fullName,
            addresseeAvatarUrl: item.person.avatarUrl,
            addresseeHeadline: item.person.headline,
            addresseeLocation: item.person.location,
            addresseeSkills: item.person.skills,
            personCard: item.person,
            createdAt: item.createdAt,
        }));
    const projectInvitations = entries
        .filter(
            (item) =>
                item.source === "invitation" && item.direction === "received",
        )
        .map((item) => ({
            ...item,
            actor: item.person,
            applicant: item.person,
        }));
    const decidedApplications = entries.filter(
        (item) => item.source === "application" && item.direction === "received" && item.applicationStatus,
    );
    const projectApplications = entries
        .filter((item) => item.source === "application" && item.direction === "received" && !item.applicationStatus)
        .map((item) => ({
            ...item,
            actor: item.person,
            applicant: item.person,
        }));
    const sentApplications = entries.filter(
        (item) => item.source === "application" && item.direction === "sent" && item.applicationStatus,
    );
    const sentProjectInvitations: SentProjectInvitationItem[] = entries
        .filter(
            (item) => item.source === "invitation" && item.direction === "sent",
        )
        .map((item) => ({
            id: item.id,
            invitationId: item.id,
            projectId: item.projectId!,
            projectTitle: item.projectTitle!,
            projectSlug: item.projectSlug,
            roleTitle: item.roleTitle!,
            candidate: item.person as SentProjectInvitationItem["candidate"],
            createdAt: new Date(item.createdAt),
            status: "pending",
            note: item.note,
        }));

    async function refreshInvitationSurfaces() {
        await Promise.all([
            queryClient.invalidateQueries({
                queryKey: queryKeys.myWork.joinRequestsRoot(),
            }),
            queryClient.invalidateQueries({
                queryKey: queryKeys.myWork.sentProjectInvitationsRoot(),
            }),
            queryClient.invalidateQueries({
                queryKey: queryKeys.myWork.root(),
            }),
            queryClient.invalidateQueries({
                queryKey: queryKeys.notifications.root(),
            }),
            queryClient.invalidateQueries({
                queryKey: queryKeys.connections.pending(),
            }),
            refreshPendingCounts(),
        ]);
    }

    async function acceptConnection(id: string, name: string) {
        try {
            await acceptRequest.mutateAsync(id);
            try {
                const confetti = (await import("canvas-confetti")).default;
                confetti({
                    particleCount: 40,
                    spread: 60,
                    origin: { y: 0.8 },
                    disableForReducedMotion: true,
                });
            } catch {
                // Ignore reduced motion or dynamic import errors
            }
            toast.success(`You’re now connected with ${name}`);
            return true;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Couldn’t accept invitation");
            return false; // Preserve the review dialog on failure.
        } finally {
            void refreshInvitationSurfaces();
        }
    }

    async function declineConnection(id: string) {
        try {
            await rejectRequest.mutateAsync({ id });
            toast.success("Invitation declined", {
                action: {
                    label: "Undo",
                    onClick: () => {
                        void undoRejectRequest
                            .mutateAsync(id)
                            .then(() => {
                                toast.success("Decline undone");
                                void refreshInvitationSurfaces();
                            })
                            .catch(() => {
                                toast.error("Couldn’t undo");
                            });
                    },
                },
            });
            return true;
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Couldn’t decline invitation");
            return false; // Preserve the review dialog on failure.
        } finally {
            void refreshInvitationSurfaces();
        }
    }

    async function handleCancelConnection(id: string, name?: string) {
        await toast
            .promise(cancelRequest.mutateAsync(id), {
                loading: "Canceling connection request…",
                success: name
                    ? `Canceled request to ${name}`
                    : "Request canceled",
                error: (error) =>
                    error instanceof Error
                        ? error.message
                        : "Failed to cancel request",
            })
            .unwrap()
            .catch(() => undefined);
        void refreshInvitationSurfaces();
    }

    async function handleWithdrawAllSent() {
        try {
            await toast
                .promise(withdrawAllSent.mutateAsync(), {
                    loading: "Canceling all sent requests…",
                    success: "All sent requests canceled",
                    error: (error) =>
                        error instanceof Error
                            ? error.message
                            : "Couldn’t cancel sent requests",
                })
                .unwrap();
        } catch {
            // Handled
        } finally {
            setIsWithdrawAllConfirmOpen(false);
            void refreshInvitationSurfaces();
        }
    }

    async function handleCancelSentProjectInvitation(
        item: SentProjectInvitationItem,
    ) {
        setCancellingProjectId(item.id);
        try {
            await toast
                .promise(
                    cancelSentProjectInvitationAction({
                        invitationId: item.invitationId,
                    }).then((res) => {
                        if (!res.success)
                            throw new Error(
                                res.error ||
                                    "Failed to cancel project invitation",
                            );
                        return res;
                    }),
                    {
                        loading: "Canceling project invitation…",
                        success: "Project invitation canceled",
                        error: (error) =>
                            error instanceof Error
                                ? error.message
                                : "Failed to cancel project invitation",
                    },
                )
                .unwrap();

            // Only after it really cancelled: a failure keeps the row (the toast says why).
            queryClient.setQueryData<SentProjectInvitationItem[]>(
                queryKeys.myWork.sentProjectInvitations(50),
                (prev) => (prev ? prev.filter((p) => p.id !== item.id) : []),
            );

            await refreshInvitationSurfaces();
            return true;
        } catch {
            return false; // Preserve the review dialog on failure.
        } finally {
            setCancellingProjectId(null);
        }
    }

    async function resolveProjectInvitation(
        id: string,
        action: "accept" | "decline",
    ) {
        setProcessingProject({ id, action });
        try {
            const request = resolveProjectInvitationAction({
                invitationId: id,
                action,
            }).then((result) => {
                if (!result.success)
                    throw new Error(
                        result.error || "Failed to update project invitation",
                    );
                return result;
            });
            await toast
                .promise(request, {
                    loading:
                        action === "accept"
                            ? "Accepting project invitation…"
                            : "Declining project invitation…",
                    success:
                        action === "accept"
                            ? "Project invitation accepted"
                            : "Project invitation declined",
                    error: (error) =>
                        error instanceof Error
                            ? error.message
                            : "Failed to update project invitation",
                })
                .unwrap();
            await refreshInvitationSurfaces();
            return true;
        } catch {
            return false; // Preserve the review dialog on failure.
        } finally {
            setProcessingProject(null);
        }
    }

    /** Resolves to an error message for the dialog, or null once the application is withdrawn. */
    async function withdrawSentApplication(note: string) {
        const target = withdrawingApplication;
        if (!target) return "This application is no longer available.";
        const result = await withdrawApplicationAction(target.id, note || undefined);
        if (!result.success) return result.error || "Could not withdraw the application.";
        setWithdrawingApplication(null);
        toast.success("Application withdrawn");
        await refreshInvitationSurfaces();
        void queryClient.invalidateQueries({ queryKey: queryKeys.connections.invitationBrowse(initialUser?.id ?? "", browse) });
        return null;
    }

    /** Resolves to an error message for the review dialog, or null once the decision was saved. */
    async function decideApplication(
        id: string,
        mode: "accept" | "decline",
        input: DecisionInput,
        name: string,
    ) {
        setProcessingApplication({ id, action: mode });
        try {
            const result =
                mode === "accept"
                    ? await acceptApplicationAction(id, input.note || undefined)
                    : await rejectApplicationAction(id, input.note || undefined, input.reason);
            if (!result.success)
                return result.error || `Could not ${mode} the application.`;
            if (mode === "accept") toast.success(`${name} accepted`);
            else
                toast.success(`${name} declined`, {
                    action: {
                        label: "Undo",
                        onClick: () => {
                            void reopenApplicationAction(id).then((undone) => {
                                if (undone.success) toast.success("Decline undone");
                                else toast.error(feedbackError(undone.error || "Could not undo", "Could not undo"));
                                void refreshInvitationSurfaces();
                            });
                        },
                    },
                });
            void refreshInvitationSurfaces();
            return null;
        } finally {
            setProcessingApplication(null);
        }
    }

    async function reopenDecided(id: string) {
        const result = await reopenApplicationAction(id);
        if (result.success) toast.success("Application reopened");
        else toast.error(feedbackError(result.error || "Could not reopen the application", "Could not reopen the application"));
        await refreshInvitationSurfaces();
    }

    // Option C (Smart Perceptual Threshold): 0-150ms keeps cards at 100% brightness; >150ms renders skeleton
    const isQueryTransition = (invitationsQuery.isFetching || invitationsQuery.isPlaceholderData) && !invitationsQuery.isFetchingNextPage;
    const [showThresholdSkeleton, setShowThresholdSkeleton] = useState(false);

    useEffect(() => {
        onLoadingChange?.(isQueryTransition);
    }, [isQueryTransition, onLoadingChange]);

    useEffect(() => {
        if (!isQueryTransition) {
            setShowThresholdSkeleton(false);
            return;
        }
        const timer = setTimeout(() => {
            setShowThresholdSkeleton(true);
        }, 150);
        return () => clearTimeout(timer);
    }, [isQueryTransition]);

    const isInitialLoading =
        invitationsQuery.isLoading && !invitationsQuery.data;
    useEffect(() => {
        if (!isInitialLoading) onReady?.();
    }, [isInitialLoading, onReady]);
    const hasOtherSections = Boolean(
        projectInvitations.length ||
        projectApplications.length ||
        decidedApplications.length ||
        sentApplications.length ||
        sentConnectionRequests.length ||
        sentProjectInvitations.length,
    );

    const orgRequests = useOrgRequests().data;
    const hasOrgRequests = Boolean(orgRequests && (orgRequests.invites.length > 0 || orgRequests.joinRequests.length > 0));
    const hasInvitations =
        hasOrgRequests ||
        connectionInvitations.length > 0 ||
        projectInvitations.length > 0 ||
        projectApplications.length > 0 ||
        decidedApplications.length > 0 ||
        sentApplications.length > 0 ||
        sentConnectionRequests.length > 0 ||
        sentProjectInvitations.length > 0;

    const showSkeleton = isInitialLoading || showThresholdSkeleton || (entries.length === 0 && isQueryTransition);

    if (showSkeleton) {
        return (
            <div
                className={INVITATION_GRID}
                aria-label="Loading invitations"
                role="status"
            >
                <span className="sr-only">Loading invitations…</span>
                {[1, 2].map((item) => (
                    <InvitationCardSkeleton key={item} />
                ))}
            </div>
        );
    }

    if (!hasInvitations && invitationsQuery.isError) {
        return (
            <div className="max-w-[620px] rounded-lg border border-border bg-card p-8 text-center">
                <h2 className="nb-card-title text-foreground">
                    Invitations could not be loaded.
                </h2>
                <p className="mt-1 text-sm max-md:text-[13px] text-muted-foreground">
                    Try again.
                </p>
                <button
                    type="button"
                    onClick={() => void invitationsQuery.refetch()}
                    className="mt-4 text-sm max-md:text-[13px] font-medium text-primary hover:underline"
                >
                    Retry
                </button>
            </div>
        );
    }

    if (!hasInvitations && !invitationsQuery.hasNextPage) {
        return (
            <div className="max-w-[620px]">
                <EmptyState
                    icon={UserPlus}
                    title={
                        filtered
                            ? "No invitations match your search or filters."
                            : "No pending invitations."
                    }
                    description={
                        filtered
                            ? "Try a different name, role, project, or filter."
                            : "Connection and project invitations will appear here."
                    }
                    action={
                        filtered && onReset ? (
                            <button
                                onClick={onReset}
                                className="text-primary hover:underline"
                            >
                                Reset search and filters
                            </button>
                        ) : undefined
                    }
                />
            </div>
        );
    }

    return (
        <div className="grid gap-6">
            {invitationsQuery.isRefetchError ? (
                <p role="alert" className="nb-compact">
                    Invitations could not be refreshed.{" "}
                    <button
                        className="text-primary hover:underline"
                        onClick={() => void invitationsQuery.refetch()}
                    >
                        Retry refresh
                    </button>
                </p>
            ) : null}
            {/* Organization invitations, and a link to join requests for orgs you run (report §30.6). */}
            <OrgRequestsSection joinRequests="link" />
            <p className="nb-meta text-muted-foreground" role="status">
                {invitationsQuery.data?.pages[0]?.total ?? 0}{" "}
                {filtered ? "matching" : "open"} invitations and applications
            </p>
            {connectionInvitations.length ? (
                <section aria-labelledby="connection-invitations-heading">
                    <h2
                        id="connection-invitations-heading"
                        className={
                            hasOtherSections ? "nb-micro mb-3" : "sr-only"
                        }
                    >
                        Connection invitations
                    </h2>
                    <div className={INVITATION_GRID}>
                        {connectionInvitations.map((invitation) => {
                            const profile = {
                                id: invitation.requesterId,
                                username: invitation.requesterUsername,
                                fullName: invitation.requesterFullName,
                                avatarUrl: invitation.requesterAvatarUrl,
                            };
                            const displayName =
                                invitation.requesterFullName ||
                                invitation.requesterUsername ||
                                "NetworkBase member";

                            return (
                                <PersonCardContent
                                    key={invitation.id}
                                    person={{
                                        ...profile,
                                        headline: invitation.requesterHeadline,
                                        location: invitation.requesterLocation,
                                        skills: invitation.requesterSkills,
                                        ...invitation.personCard,
                                    }}
                                    footer={requestDate(invitation.createdAt)}
                                    action={
                                        <PersonCardReview
                                            name={displayName}
                                            description="would like to connect with you"
                                            note={invitation.message}
                                            onAccept={() =>
                                                acceptConnection(
                                                    invitation.id,
                                                    displayName.split(" ")[0] ||
                                                        displayName,
                                                )
                                            }
                                            onDecline={() =>
                                                declineConnection(invitation.id)
                                            }
                                        />
                                    }
                                />
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {projectInvitations.length ? (
                <section aria-labelledby="project-invitations-heading">
                    <h2
                        id="project-invitations-heading"
                        className="nb-micro mb-3"
                    >
                        Project invitations
                    </h2>
                    <div className={INVITATION_GRID}>
                        {projectInvitations.map((invitation) => {
                            const actor =
                                invitation.actor ?? invitation.applicant;
                            const displayName =
                                actor?.fullName ||
                                actor?.username ||
                                "NetworkBase member";
                            return (
                                <PersonCardContent
                                    key={invitation.id}
                                    person={actor ?? {}}
                                    context={
                                        <Link
                                            className="nb-person-portfolio"
                                            href={`/projects/${invitation.projectSlug || invitation.projectId}`}
                                            title={`${invitation.roleTitle} · ${invitation.projectTitle}`}
                                        >
                                            <span>
                                                Invitation ·{" "}
                                                {invitation.roleTitle} · {invitation.projectTitle}
                                            </span>
                                        </Link>
                                    }
                                    footer={requestDate(invitation.createdAt)}
                                    action={
                                        <PersonCardReview
                                            name={displayName}
                                            description={`Invitation to ${invitation.projectTitle} · ${invitation.roleTitle}`}
                                            onAccept={() =>
                                                resolveProjectInvitation(
                                                    invitation.id,
                                                    "accept",
                                                )
                                            }
                                            onDecline={() =>
                                                resolveProjectInvitation(
                                                    invitation.id,
                                                    "decline",
                                                )
                                            }
                                        />
                                    }
                                />
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {projectApplications.length ? (
                <section aria-labelledby="project-applications-heading">
                    <h2
                        id="project-applications-heading"
                        className="nb-micro mb-3"
                    >
                        Project applications
                    </h2>
                    <div className={INVITATION_GRID}>
                        {projectApplications.map((app) => {
                            const actor = app.actor ?? app.applicant;
                            const name = personCardName(actor ?? {});
                            return (
                                <PersonCardContent
                                    key={app.id}
                                    person={actor ?? {}}
                                    context={
                                        <Link
                                            className="nb-person-portfolio"
                                            href={`/projects/${app.projectSlug || app.projectId}`}
                                            title={`${app.roleTitle} · ${app.projectTitle}`}
                                        >
                                            <span>
                                                Application · {app.roleTitle}
                                            </span>
                                        </Link>
                                    }
                                    footer={requestDate(app.createdAt)}
                                    action={
                                        <ApplicationReview
                                            applicationId={app.id}
                                            applicantName={name}
                                            profileHref={profileHref(actor ?? {})}
                                            headline={actor?.headline}
                                            location={actor?.location}
                                            skills={actor?.skills}
                                            roleTitle={app.roleTitle}
                                            projectTitle={app.projectTitle}
                                            message={app.note}
                                            details={app.details}
                                            channelId={app.channelId}
                                            onDecide={(mode, input) =>
                                                decideApplication(app.id, mode, input, name)
                                            }
                                        />
                                    }
                                />
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {decidedApplications.length ? (
                <section aria-labelledby="decided-applications-heading">
                    <h2 id="decided-applications-heading" className="nb-micro mb-3">
                        Decided applications · last 30 days
                    </h2>
                    <div className={INVITATION_GRID}>
                        {decidedApplications.map((app) => {
                            const actor = app.person;
                            const name = personCardName(actor ?? {});
                            return (
                                <PersonCardContent
                                    key={app.id}
                                    person={actor ?? {}}
                                    context={
                                        <Link
                                            className="nb-person-portfolio"
                                            href={`/projects/${app.projectSlug || app.projectId}`}
                                            title={`${app.roleTitle} · ${app.projectTitle}`}
                                        >
                                            <span>{app.roleTitle} · {app.projectTitle}</span>
                                        </Link>
                                    }
                                    footer={
                                        <>
                                            {requestDate(app.createdAt, app.applicationStatus === "accepted" ? "Accepted" : app.applicationStatus === "withdrawn" ? "Withdrawn" : "Declined")}
                                            {app.decisionReason ? <span className="nb-meta block text-muted-foreground">{app.decisionReason}</span> : null}
                                        </>
                                    }
                                    action={
                                        <DecidedApplicationMenu
                                            status={app.applicationStatus as "accepted" | "rejected" | "withdrawn"}
                                            applicantName={name}
                                            profileHref={profileHref(actor ?? {})}
                                            channelId={app.channelId}
                                            decidedAt={app.createdAt}
                                            reasonCode={app.decisionCode}
                                            roleRemoved={app.roleTitle === "Role removed"}
                                            onReopen={() => void reopenDecided(app.id)}
                                        />
                                    }
                                />
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {sentApplications.length ? (
                <section aria-labelledby="sent-applications-heading">
                    <h2 id="sent-applications-heading" className="nb-micro mb-3">
                        Your applications
                    </h2>
                    <div className={INVITATION_GRID}>
                        {sentApplications.map((application) => {
                            const status = application.applicationStatus!;
                            const owner = application.person;
                            return (
                                <PersonCardContent
                                    key={application.id}
                                    person={owner}
                                    context={
                                        <Link
                                            className="nb-person-portfolio"
                                            href={`/projects/${application.projectSlug || application.projectId}`}
                                            title={`${application.roleTitle} · ${application.projectTitle}`}
                                        >
                                            <span>
                                                {application.roleTitle} · {application.projectTitle}
                                            </span>
                                        </Link>
                                    }
                                    footer={
                                        <>
                                            {requestDate(application.createdAt, status === "pending" ? "Applied" : status === "accepted" ? "Accepted" : status === "withdrawn" ? "Withdrawn" : "Declined")}
                                            {(status === "rejected" || status === "withdrawn") && application.decisionReason ? (
                                                <span className="nb-meta block text-muted-foreground">{application.decisionReason}</span>
                                            ) : null}
                                        </>
                                    }
                                    action={
                                        <SentApplicationMenu
                                            status={status}
                                            reasonCode={application.decisionCode}
                                            name={application.projectTitle || "the project"}
                                            projectHref={`/projects/${application.projectSlug || application.projectId}`}
                                            channelId={application.channelId}
                                            onWithdraw={(trigger) => { withdrawReturn.current = trigger; setWithdrawingApplication(application); }}
                                        />
                                    }
                                />
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {sentProjectInvitations.length ? (
                <section aria-labelledby="sent-project-invitations-heading">
                    <h2
                        id="sent-project-invitations-heading"
                        className="nb-micro mb-3"
                    >
                        Sent project invitations
                    </h2>
                    <div className={INVITATION_GRID}>
                        {sentProjectInvitations.map((invitation) => {
                            const candidate = invitation.candidate;
                            const displayName =
                                candidate.fullName ||
                                candidate.username ||
                                "NetworkBase member";

                            return (
                                <PersonCardContent
                                    key={invitation.id}
                                    person={candidate}
                                    context={
                                        <Link
                                            className="nb-person-portfolio"
                                            href={`/projects/${invitation.projectSlug || invitation.projectId}`}
                                            title={`${invitation.roleTitle} · ${invitation.projectTitle}`}
                                        >
                                            <span>
                                                Invited · {invitation.roleTitle}
                                            </span>
                                        </Link>
                                    }
                                    footer={requestDate(invitation.createdAt)}
                                    action={
                                        <PersonCardCancelMenu
                                            label="Invited"
                                            name={displayName}
                                            href={profileHref(candidate)}
                                            busy={
                                                cancellingProjectId ===
                                                invitation.id
                                            }
                                            onCancel={() =>
                                                handleCancelSentProjectInvitation(
                                                    invitation,
                                                )
                                            }
                                        />
                                    }
                                />
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {sentConnectionRequests.length ? (
                <section aria-labelledby="sent-requests-heading">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 id="sent-requests-heading" className="nb-micro">
                            Sent connection requests
                        </h2>
                        {sentConnectionRequests.length > 1 && !filtered ? (
                            <button
                                type="button"
                                onClick={() =>
                                    setIsWithdrawAllConfirmOpen(true)
                                }
                                disabled={withdrawAllSent.isPending}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                            >
                                {withdrawAllSent.isPending
                                    ? "Canceling all…"
                                    : "Cancel all"}
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
                            const displayName =
                                request.addresseeFullName ||
                                request.addresseeUsername ||
                                "NetworkBase member";
                            const isCancelling =
                                cancelRequest.isPending &&
                                (cancelRequest.variables === request.id ||
                                    cancelRequest.variables ===
                                        request.addresseeId);

                            return (
                                <PersonCardContent
                                    key={request.id}
                                    person={{
                                        ...profile,
                                        headline: request.addresseeHeadline,
                                        location: request.addresseeLocation,
                                        skills: request.addresseeSkills,
                                        ...request.personCard,
                                    }}
                                    footer={requestDate(request.createdAt)}
                                    action={
                                        <PersonCardCancelMenu
                                            label="Requested"
                                            name={displayName}
                                            href={profileHref(profile)}
                                            busy={isCancelling}
                                            onCancel={() =>
                                                handleCancelConnection(
                                                    request.id,
                                                    displayName,
                                                )
                                            }
                                        />
                                    }
                                />
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {invitationsQuery.hasNextPage ? (
                <div className="flex flex-col items-start gap-2">
                    {invitationsQuery.isFetchNextPageError ? (
                        <p role="alert" className="nb-compact">
                            More invitations could not be loaded.
                        </p>
                    ) : null}
                    <button
                        className="nb-person-control"
                        disabled={invitationsQuery.isFetchingNextPage}
                        onClick={() => void invitationsQuery.fetchNextPage()}
                    >
                        {invitationsQuery.isFetchingNextPage
                            ? "Loading…"
                            : invitationsQuery.isFetchNextPageError
                              ? "Retry loading more"
                              : "Load more invitations"}
                    </button>
                </div>
            ) : null}
            <WithdrawApplicationDialog
                open={Boolean(withdrawingApplication)}
                roleTitle={withdrawingApplication?.roleTitle}
                onClose={() => setWithdrawingApplication(null)}
                onConfirm={withdrawSentApplication}
                returnFocusTo={withdrawReturn.current}
            />
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
const INVITATION_GRID =
    "nb-person-card-grid grid grid-cols-1 gap-[14px] sm:grid-cols-2";

function requestDate(value?: Date | string | null, label = "Requested") {
    const date = personRequestDate(value, Date.now(), label);
    if (!date) return null;
    return (
        <span className="nb-meta nb-person-date" title={date.title}>
            <span className="nb-person-date-full">
                {date.text}
            </span>
            <span className="nb-person-date-compact">
                {date.compactText}
            </span>
        </span>
    );
}
