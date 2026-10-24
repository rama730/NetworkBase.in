"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { acceptApplicationAction, acceptApplicationsAction, getIncomingApplicationsAction, rejectApplicationAction, reopenApplicationAction } from "@/app/actions/applications";
import { DecisionDialog, type DecisionInput } from "@/components/applications/DecisionDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { personCardName } from "@/lib/network/person-card";
import { resolveProjectInvitationAction } from "@/app/actions/project/guidance";
import { queryKeys } from "@/lib/query-keys";
import { useUIStore } from "@/stores/ui-store";
import { Inbox } from "lucide-react";
import {
    IncomingProjectApplicationRow,
    type IncomingProjectApplication,
} from "@/components/network/IncomingProjectApplicationRow";
import { toast, feedbackError } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { RequestProfileRow } from "@/components/network/RequestProfileRow";
import { useConnectionMutations, usePendingRequests } from "@/hooks/useConnections";

interface WorkspaceRequestsTabProps {
    isActive?: boolean;
}

type WorkspaceRequest = IncomingProjectApplication & { status: string };

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Failed";
}

/** The actions answer {success:false} instead of throwing; without this a refused decision looked like a success. */
function unwrap<T extends { success: boolean; error?: string }>(result: T): T {
    if (!result.success) throw new Error(result.error || "That didn't work. Try again.");
    return result;
}

function WorkspaceRequestsSkeleton() {
    return (
        <div className="w-full space-y-5 px-1 py-1" aria-busy="true" aria-label="Loading invitations">
            <div aria-hidden="true" className="nb-skeleton mb-4 h-4 w-3/4 rounded-[3px]" />
            {[1, 2].map((section) => (
                <div key={section} className="space-y-2.5">
                    <div aria-hidden="true" className="nb-skeleton h-3 w-36 rounded-[3px]" />
                    <div className="space-y-2">
                        {[1, 2].map((row) => (
                            <div key={row} className="flex items-center justify-between gap-3 rounded-[8px] border border-border/60 bg-card p-3">
                                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <div aria-hidden="true" className="nb-skeleton h-8 w-8 shrink-0 rounded-[5px]" />
                                    <div className="space-y-1.5 flex-1 min-w-0">
                                        <div aria-hidden="true" className="nb-skeleton h-3.5 w-32 rounded-[3px]" />
                                        <div aria-hidden="true" className="nb-skeleton h-3 w-48 rounded-[3px]" />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <div aria-hidden="true" className="nb-skeleton h-7 w-16 rounded-[5px]" />
                                    <div aria-hidden="true" className="nb-skeleton h-7 w-16 rounded-[5px]" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function WorkspaceRequestsTab({ isActive = true }: WorkspaceRequestsTabProps) {
    const isWorkspaceOpen = useUIStore((s) => s.isWorkspaceOpen);
    const setWorkspaceOpen = useUIStore((s) => s.setWorkspaceOpen);
    const queryClient = useQueryClient();
    const [isBatchBusy, setIsBatchBusy] = useState(false);
    const [declining, setDeclining] = useState<WorkspaceRequest | null>(null);
    const [accepting, setAccepting] = useState<WorkspaceRequest | null>(null);
    const [confirmAcceptAll, setConfirmAcceptAll] = useState(false);

    const query = useQuery({
        queryKey: queryKeys.workspace.joinRequests(20),
        // This is a compact launcher surface. Connections owns the full,
        // paginated request queue rather than hiding an unbounded list here.
        queryFn: () => getIncomingApplicationsAction({ limit: 20 }),
        enabled: isWorkspaceOpen && isActive,
        staleTime: 30_000,
    });
    const { data, isLoading, error } = query;
    // Workspace only presents decisions the viewer can take. It
    // never fetches the sent queue that is only useful in the full Requests
    // page, eliminating one request and unrelated loading/error state.
    const connectionsQuery = usePendingRequests(20, isWorkspaceOpen && isActive, { includeSent: false });
    const { acceptRequest, rejectRequest, undoRejectRequest } = useConnectionMutations();

    const incomingApplications = useMemo<WorkspaceRequest[]>(
        () => (data?.applications ?? []) as WorkspaceRequest[],
        [data?.applications],
    );

    // Pending applications to your projects
    const pendingIncoming = useMemo(
        () => incomingApplications.filter((app) => app.status === "pending" && !app.isInvitation),
        [incomingApplications],
    );
    const pendingInvites = useMemo(
        () => incomingApplications.filter((app) => app.status === "pending" && app.isInvitation),
        [incomingApplications],
    );
    const pendingConnections = connectionsQuery.data?.incoming ?? [];

    const removeOptimistically = (id: string) => {
        queryClient.setQueryData(queryKeys.workspace.joinRequests(20), (previous: typeof data) => {
            if (!previous?.success) return previous;
            return {
                ...previous,
                applications: previous.applications.filter((application) => application.id !== id),
            };
        });
    };

    const invalidate = () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspace.root() });
        void queryClient.invalidateQueries({ queryKey: ["connections", "pending-requests"] });
        // The Network page's open and decided lists.
        void queryClient.invalidateQueries({ queryKey: queryKeys.connections.pending() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.root() });
    };

    /** Accepting offers a welcome note first; an error comes back to the dialog. */
    const acceptApp = async (app: WorkspaceRequest, { note }: DecisionInput) => {
        removeOptimistically(app.id);
        try {
            unwrap(await acceptApplicationAction(app.id, note || undefined));
        } catch (failure) {
            invalidate();
            return errorMessage(failure);
        }
        toast.success(`${personCardName(app.applicant ?? {})} accepted`);
        invalidate();
        return null;
    };

    /** Declining asks for a reason first; an error comes back to the dialog, a success offers Undo. */
    const declineApp = async (app: WorkspaceRequest, { reason, note }: DecisionInput) => {
        removeOptimistically(app.id);
        try {
            unwrap(await rejectApplicationAction(app.id, note || undefined, reason));
        } catch (failure) {
            invalidate();
            return errorMessage(failure);
        }
        toast.success("Declined", {
            action: {
                label: "Undo",
                onClick: () => void reopenApplicationAction(app.id).then((undone) => {
                    if (undone.success) toast.success("Decline undone");
                    else toast.error(feedbackError(undone.error || "Could not undo", "Could not undo"));
                    invalidate();
                }),
            },
        });
        invalidate();
        return null;
    };

    const acceptInvite = useMutation({
        mutationFn: async (id: string) => unwrap(await resolveProjectInvitationAction({ invitationId: id, action: "accept" })),
        onMutate: removeOptimistically,
        onSuccess: () => { toast.success("Invite accepted"); invalidate(); },
        onError: (error: unknown) => { invalidate(); toast.error(feedbackError(errorMessage(error), "Action couldn’t finish")); },
    });

    const rejectInvite = useMutation({
        mutationFn: async (id: string) => unwrap(await resolveProjectInvitationAction({ invitationId: id, action: "decline" })),
        onMutate: removeOptimistically,
        onSuccess: () => { toast.success("Invite rejected"); invalidate(); },
        onError: (error: unknown) => { invalidate(); toast.error(feedbackError(errorMessage(error), "Action couldn’t finish")); },
    });

    const resolveConnection = async (requestId: string, action: "accept" | "reject") => {
        try {
            if (action === "accept") {
                await acceptRequest.mutateAsync(requestId);
                toast.success("Connection request accepted");
            } else {
                await rejectRequest.mutateAsync({ id: requestId });
                toast.success("Connection request declined", {
                    action: {
                        label: "Undo",
                        onClick: () => {
                            void undoRejectRequest
                                .mutateAsync(requestId)
                                .then(() => {
                                    toast.success("Decline undone");
                                    invalidate();
                                })
                                .catch(() => {
                                    toast.error("Could not undo");
                                });
                        },
                    },
                });
            }
            invalidate();
        } catch (connectionError) {
            toast.error(feedbackError(errorMessage(connectionError), "Action couldn’t finish"));
        }
    };

    /** Runs every item, then says how many went through (one failure no longer hides the successes). */
    const acceptEach = async (ids: string[], accept: (id: string) => Promise<unknown>, noun: string) => {
        if (isBatchBusy || ids.length === 0) return;
        setIsBatchBusy(true);
        try {
            const settled = await Promise.allSettled(ids.map((id) => accept(id)));
            const accepted = settled.filter((item) => item.status === "fulfilled").length;
            const failed = settled.find((item): item is PromiseRejectedResult => item.status === "rejected");
            if (!failed) toast.success(`Accepted ${accepted} ${noun}${accepted === 1 ? "" : "s"}`);
            else if (accepted) toast.warning(`Accepted ${accepted}, ${ids.length - accepted} could not be accepted`, { description: errorMessage(failed.reason) });
            else toast.error(feedbackError(errorMessage(failed.reason), "Action couldn’t finish"));
        } finally {
            invalidate();
            setIsBatchBusy(false);
        }
    };

    const handleAcceptAllConnections = () => acceptEach(pendingConnections.map((req) => req.id), (id) => acceptRequest.mutateAsync(id), "connection request");

    const handleAcceptAllInvites = () => acceptEach(pendingInvites.map((inv) => inv.id), (id) => acceptInvite.mutateAsync(id), "project invite");

    /** One confirmation, then one result per application: what was accepted, what was not, and why. */
    const handleAcceptAllIncoming = async () => {
        if (isBatchBusy || pendingIncoming.length === 0) return;
        setConfirmAcceptAll(false);
        setIsBatchBusy(true);
        try {
            const outcome = await acceptApplicationsAction(pendingIncoming.map((app) => app.id));
            const accepted = outcome.results.filter((item) => item.success).length;
            const failed = outcome.results.filter((item) => !item.success);
            if (!failed.length) toast.success(`Accepted ${accepted} application${accepted === 1 ? "" : "s"}`);
            else if (accepted) toast.warning(`Accepted ${accepted}, ${failed.length} could not be accepted`, { description: failed[0]?.error });
            else toast.error(feedbackError(failed[0]?.error || outcome.error || "No application could be accepted", "No application could be accepted"));
        } catch (batchErr) {
            toast.error(feedbackError(errorMessage(batchErr), "Action couldn’t finish"));
        } finally {
            invalidate();
            setIsBatchBusy(false);
        }
    };

    if (isLoading || connectionsQuery.isLoading) {
        return <WorkspaceRequestsSkeleton />;
    }

    if (error || connectionsQuery.error || (data && !data.success)) {
        return (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
                <p className="text-xs font-medium text-destructive">
                    Failed to load invitations. Please try again later.
                </p>
                <button type="button" onClick={() => void query.refetch()} className="mt-2 text-xs font-semibold text-destructive underline underline-offset-2">Try again</button>
            </div>
        );
    }

    const hasAnyRequests = pendingConnections.length > 0 || pendingInvites.length > 0 || pendingIncoming.length > 0;

    if (!hasAnyRequests) {
        return (
            <div className="nb-empty-state nb-grid-ground py-12">
                <Inbox className="nb-empty-state-icon" aria-hidden="true" />
                <h4 className="nb-card-title text-foreground">No pending invitations</h4>
                <p className="nb-compact mx-auto mt-1 max-w-xs text-muted-foreground">
                    You have no new invitations at this time.
                </p>
            </div>
        );
    }

    return (
        <div id="workspace-requests-panel" role="tabpanel" aria-labelledby="workspace-requests-tab" className="w-full px-1 pb-10">
            <p className="mb-4 px-1 text-[13px] leading-5 text-muted-foreground">
                Connection and project decisions that need your attention, in one place.
            </p>
            {pendingConnections.length > 0 && (
                <div className="mb-6">
                    <div className="mb-3 flex items-center justify-between pl-1">
                        <h4 className="nb-micro">Connection requests ({pendingConnections.length})</h4>
                        {pendingConnections.length > 1 && (
                            <button
                                type="button"
                                disabled={isBatchBusy}
                                onClick={handleAcceptAllConnections}
                                className="text-[11px] font-semibold text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                            >
                                {isBatchBusy ? "Accepting all..." : `Accept all (${pendingConnections.length})`}
                            </button>
                        )}
                    </div>
                    <div className="space-y-2">
                        {pendingConnections.map((request) => {
                            const isAccepting = acceptRequest.isPending && acceptRequest.variables === request.id;
                            const isRejecting = rejectRequest.isPending && rejectRequest.variables?.id === request.id;
                            const busy = isAccepting || isRejecting || isBatchBusy;
                            return (
                                <RequestProfileRow
                                    key={request.id}
                                    profile={{
                                        id: request.requesterId,
                                        username: request.requesterUsername,
                                        fullName: request.requesterFullName,
                                        avatarUrl: request.requesterAvatarUrl,
                                        headline: request.requesterHeadline,
                                        location: request.requesterLocation ?? null,
                                    }}
                                    requestedAt={request.createdAt}
                                    actions={(
                                        <>
                                            <Button size="sm" disabled={busy} onClick={() => void resolveConnection(request.id, "accept")}>Accept</Button>
                                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void resolveConnection(request.id, "reject")}>Reject</Button>
                                        </>
                                    )}
                                />
                            );
                        })}
                    </div>
                </div>
            )}
            {pendingInvites.length > 0 && (
                <div className="mb-6">
                    <div className="mb-3 flex items-center justify-between pl-1">
                        <h4 className="nb-micro">Project invitations ({pendingInvites.length})</h4>
                        {pendingInvites.length > 1 && (
                            <button
                                type="button"
                                disabled={isBatchBusy}
                                onClick={handleAcceptAllInvites}
                                className="text-[11px] font-semibold text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                            >
                                {isBatchBusy ? "Accepting all..." : `Accept all (${pendingInvites.length})`}
                            </button>
                        )}
                    </div>
                    <div className="space-y-2">
                        {pendingInvites.map((invite) => {
                            const isAccepting = acceptInvite.isPending && acceptInvite.variables === invite.id;
                            const isRejecting = rejectInvite.isPending && rejectInvite.variables === invite.id;
                            const isProcessing = isAccepting || isRejecting || isBatchBusy;
                            
                            return <IncomingProjectApplicationRow key={invite.id} app={invite} busy={isProcessing} onAccept={() => acceptInvite.mutate(invite.id)} onReject={() => rejectInvite.mutate(invite.id)} />;
                        })}
                    </div>
                </div>
            )}

            {pendingIncoming.length > 0 && (
                <div>
                    <div className="mb-3 flex items-center justify-between pl-1">
                        <h4 className="nb-micro">Applications to your projects ({pendingIncoming.length})</h4>
                        {pendingIncoming.length > 1 && (
                            <button
                                type="button"
                                disabled={isBatchBusy}
                                onClick={() => setConfirmAcceptAll(true)}
                                className="text-[11px] font-semibold text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                            >
                                {isBatchBusy ? "Accepting…" : `Accept these ${pendingIncoming.length}`}
                            </button>
                        )}
                    </div>
                    <div className="space-y-2">
                        {pendingIncoming.map((app) => {
                            return <IncomingProjectApplicationRow key={app.id} app={app} busy={isBatchBusy} onAccept={() => setAccepting(app)} onReject={() => setDeclining(app)} />;
                        })}
                    </div>
                </div>
            )}
            <DecisionDialog
                open={accepting !== null}
                mode="accept"
                applicantName={accepting ? personCardName(accepting.applicant ?? {}) : "this person"}
                roleTitle={accepting?.roleTitle}
                onClose={() => setAccepting(null)}
                onConfirm={async (input) => {
                    const failure = accepting ? await acceptApp(accepting, input) : null;
                    if (!failure) setAccepting(null);
                    return failure;
                }}
            />
            <DecisionDialog
                open={declining !== null}
                mode="decline"
                applicantName={declining ? personCardName(declining.applicant ?? {}) : "this person"}
                roleTitle={declining?.roleTitle}
                onClose={() => setDeclining(null)}
                onConfirm={async (input) => {
                    const failure = declining ? await declineApp(declining, input) : null;
                    if (!failure) setDeclining(null);
                    return failure;
                }}
            />
            <ConfirmDialog
                open={confirmAcceptAll}
                onOpenChange={setConfirmAcceptAll}
                title={`Accept ${pendingIncoming.length} applications?`}
                description="This list shows your 20 newest applications. Each person joins their project right away, and everyone is told. Decline any you are unsure about first."
                confirmLabel={`Accept these ${pendingIncoming.length}`}
                onConfirm={() => void handleAcceptAllIncoming()}
            />
            {hasAnyRequests ? (
                <Link
                    href="/network?tab=invitations"
                    onClick={() => setWorkspaceOpen(false)}
                    className="mt-5 inline-flex text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    View all invitations
                </Link>
            ) : null}
        </div>
    );
}
