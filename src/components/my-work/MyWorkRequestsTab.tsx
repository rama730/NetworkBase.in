"use client";

import { OrgRequestsSection, useOrgRequests } from "@/components/organizations/OrgRequestsSection";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { acceptApplicationAction, acceptApplicationsAction, getIncomingApplicationsAction, rejectApplicationAction, reopenApplicationAction } from "@/app/actions/applications";
import { DecisionDialog, type DecisionInput } from "@/components/applications/DecisionDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { personCardName } from "@/lib/network/person-card";
import { resolveWorkspaceInvitationAction } from "@/app/actions/workspace/guidance";
import { queryKeys } from "@/lib/query-keys";
import { useUIStore } from "@/stores/ui-store";
import { type IncomingWorkspaceApplication } from "@/components/network/IncomingWorkspaceApplicationRow";
import { toast, feedbackError } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { PixelPerson } from "@/components/ui/PixelPerson";
import { WorkspaceAvatar } from "@/components/workspaces/WorkspaceAvatar";
import { profileHref } from "@/lib/routing/identifiers";
import { conversationHref } from "@/lib/messaging/routes";
import { useConnectionMutations, usePendingRequests } from "@/hooks/useConnections";
import { StatusPixels } from "./MyWorkTasksTab";

/** Who is waiting on you, for the ink head: faces and names, plus invitations (places, not people). */
export type MyWorkWaiting = { people: Array<{ key: string; name: string; avatarUrl: string | null }>; invitations: number };

interface MyWorkRequestsTabProps {
    isActive?: boolean;
    onWaiting?: (waiting: MyWorkWaiting) => void;
    /** Each request you answer here ("You answered 5 requests just now"). */
    onHandled?: (delta: number) => void;
}

type MyWorkRequest = IncomingWorkspaceApplication & { status: string };

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Failed";
}

/** The actions answer {success:false} instead of throwing; without this a refused decision looked like a success. */
function unwrap<T extends { success: boolean; error?: string }>(result: T): T {
    if (!result.success) throw new Error(result.error || "That didn’t work. Try again.");
    return result;
}

function MyWorkRequestsSkeleton() {
    return (
        <div className="grid gap-1" aria-busy="true" aria-label="Loading requests">
            {[70, 56, 64].map((width) => (
                <div key={width} className="nb-mw-ghost" style={{ gridTemplateColumns: "28px 1fr", minHeight: 48 }}>
                    <div aria-hidden="true" className="nb-skeleton size-7 rounded-md" />
                    <div aria-hidden="true" className="nb-skeleton h-3 rounded-[3px]" style={{ width: `${width}%` }} />
                </div>
            ))}
        </div>
    );
}

/** One request on one line: who, what they want, small Accept and Decline. Answered, it ticks and leaves. */
function RequestRow({ avatar, name, href, handle, what, note, done, children, extra }: {
    avatar: React.ReactNode; name: string; href?: string; handle?: string | null; what: React.ReactNode; note?: string | null; done?: string | null; children?: React.ReactNode; extra?: React.ReactNode;
}) {
    const [noteOpen, setNoteOpen] = useState(false);
    return (
        <div className="nb-mw-req">
            <span className="size-7 overflow-hidden rounded-md">{avatar}</span>
            <span className="txt">
                <b>{href ? <Link href={href}>{name}</Link> : name}{handle ? <span className="handle">@{handle}</span> : null}</b>
                <span>{what}{note ? <> · <button type="button" className="nb-mw-noteb" aria-expanded={noteOpen} onClick={() => setNoteOpen(!noteOpen)}>{noteOpen ? "hide note" : "note"}</button></> : null}</span>
            </span>
            {done ? <span className="nb-mw-done" role="status"><StatusPixels status="done" />{done}</span> : <span className="acts">{children}</span>}
            {noteOpen && note ? <q>{note}</q> : null}
            {extra}
        </div>
    );
}

export default function MyWorkRequestsTab({ isActive = true, onHandled, onWaiting }: MyWorkRequestsTabProps) {
    const isMyWorkOpen = useUIStore((s) => s.isMyWorkOpen);
    const setMyWorkOpen = useUIStore((s) => s.setMyWorkOpen);
    const queryClient = useQueryClient();
    const [isBatchBusy, setIsBatchBusy] = useState(false);
    const [declining, setDeclining] = useState<MyWorkRequest | null>(null);
    const [accepting, setAccepting] = useState<MyWorkRequest | null>(null);
    const [welcome, setWelcome] = useState("");
    const [confirmAcceptAll, setConfirmAcceptAll] = useState(false);
    // Answered rows show a tick for a moment before the list refreshes them away.
    const [done, setDone] = useState<Map<string, string>>(new Map());

    const query = useQuery({
        queryKey: queryKeys.myWork.joinRequests(20),
        // This is a compact launcher surface. Connections owns the full,
        // paginated request queue rather than hiding an unbounded list here.
        queryFn: () => getIncomingApplicationsAction({ limit: 20 }),
        enabled: isMyWorkOpen && isActive,
        staleTime: 30_000,
    });
    const { data, isLoading, error } = query;
    // Workspace only presents decisions the viewer can take. It
    // never fetches the sent queue that is only useful in the full Requests
    // page, eliminating one request and unrelated loading/error state.
    const connectionsQuery = usePendingRequests(20, isMyWorkOpen && isActive, { includeSent: false });
    const { acceptRequest, rejectRequest, undoRejectRequest } = useConnectionMutations();

    const incomingApplications = useMemo<MyWorkRequest[]>(
        () => (data?.applications ?? []) as MyWorkRequest[],
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
    const pendingConnections = useMemo(() => connectionsQuery.data?.incoming ?? [], [connectionsQuery.data?.incoming]);
    const orgRequests = useOrgRequests(isMyWorkOpen && isActive).data;
    const hasOrgRequests = Boolean(orgRequests && (orgRequests.invites.length > 0 || orgRequests.joinRequests.length > 0 || orgRequests.mine.length > 0));

    useEffect(() => {
        if (isLoading || connectionsQuery.isLoading) return;
        onWaiting?.({
            people: [
                ...(orgRequests?.joinRequests ?? []).flatMap((group) => group.first.map((request) => ({ key: request.id, name: request.name, avatarUrl: null }))),
                ...pendingConnections.map((request) => ({ key: request.requesterId, name: request.requesterFullName || request.requesterUsername || "Someone", avatarUrl: request.requesterAvatarUrl })),
                ...pendingIncoming.map((app) => ({ key: app.applicant?.id ?? app.id, name: app.applicant?.fullName || app.applicant?.username || "Someone", avatarUrl: app.applicant?.avatarUrl ?? null })),
            ],
            invitations: pendingInvites.length + (orgRequests?.invites.length ?? 0),
        });
    }, [isLoading, connectionsQuery.isLoading, orgRequests, pendingConnections, pendingIncoming, pendingInvites, onWaiting]);

    useEffect(() => {
        if (!done.size) return;
        const timer = setTimeout(() => setDone(new Map()), 1200);
        return () => clearTimeout(timer);
    }, [done]);
    const tick = (id: string, label: string) => { setDone((prev) => new Map(prev).set(id, label)); onHandled?.(1); };

    const removeOptimistically = (id: string) => {
        queryClient.setQueryData(queryKeys.myWork.joinRequests(20), (previous: typeof data) => {
            if (!previous?.success) return previous;
            return {
                ...previous,
                applications: previous.applications.filter((application) => application.id !== id),
            };
        });
    };

    const invalidate = () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.myWork.root() });
        void queryClient.invalidateQueries({ queryKey: ["connections", "pending-requests"] });
        // The Network page's open and decided lists.
        void queryClient.invalidateQueries({ queryKey: queryKeys.connections.pending() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.root() });
    };
    // Let the tick show before the row leaves.
    const invalidateSoon = () => setTimeout(invalidate, 900);

    /** Accepting offers a welcome note first; an error comes back to the note. */
    const acceptApp = async (app: MyWorkRequest, { note }: Pick<DecisionInput, "note">) => {
        try {
            unwrap(await acceptApplicationAction(app.id, note || undefined));
        } catch (failure) {
            invalidate();
            return errorMessage(failure);
        }
        tick(app.id, "Added");
        toast.success(`${personCardName(app.applicant ?? {})} accepted`);
        setTimeout(() => removeOptimistically(app.id), 900);
        invalidateSoon();
        return null;
    };

    /** Declining asks for a reason first; an error comes back to the dialog, a success offers Undo. */
    const declineApp = async (app: MyWorkRequest, { reason, note }: DecisionInput) => {
        removeOptimistically(app.id);
        try {
            unwrap(await rejectApplicationAction(app.id, note || undefined, reason));
        } catch (failure) {
            invalidate();
            return errorMessage(failure);
        }
        onHandled?.(1);
        toast.success("Declined", {
            action: {
                label: "Undo",
                onClick: () => void reopenApplicationAction(app.id).then((undone) => {
                    if (undone.success) { toast.success("Decline undone"); onHandled?.(-1); }
                    else toast.error(feedbackError(undone.error || "Couldn’t undo", "Couldn’t undo"));
                    invalidate();
                }),
            },
        });
        invalidate();
        return null;
    };

    const acceptInvite = useMutation({
        mutationFn: async (id: string) => unwrap(await resolveWorkspaceInvitationAction({ invitationId: id, action: "accept" })),
        onSuccess: (_, id) => { tick(id, "Joined"); toast.success("Invite accepted"); setTimeout(() => removeOptimistically(id), 900); invalidateSoon(); },
        onError: (error: unknown) => { invalidate(); toast.error(feedbackError(errorMessage(error), "Action couldn’t finish")); },
    });

    const rejectInvite = useMutation({
        mutationFn: async (id: string) => unwrap(await resolveWorkspaceInvitationAction({ invitationId: id, action: "decline" })),
        onMutate: removeOptimistically,
        onSuccess: () => { onHandled?.(1); toast.success("Declined"); invalidate(); },
        onError: (error: unknown) => { invalidate(); toast.error(feedbackError(errorMessage(error), "Action couldn’t finish")); },
    });

    const resolveConnection = async (requestId: string, action: "accept" | "reject") => {
        try {
            if (action === "accept") {
                await acceptRequest.mutateAsync(requestId);
                tick(requestId, "Connected");
                toast.success("Connection request accepted");
                invalidateSoon();
                return;
            }
            await rejectRequest.mutateAsync({ id: requestId });
            onHandled?.(1);
            toast.success("Request declined", {
                action: {
                    label: "Undo",
                    onClick: () => {
                        void undoRejectRequest
                            .mutateAsync(requestId)
                            .then(() => {
                                toast.success("Decline undone");
                                onHandled?.(-1);
                                invalidate();
                            })
                            .catch(() => {
                                toast.error("Couldn’t undo");
                            });
                    },
                },
            });
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
            onHandled?.(accepted);
            if (!failed) toast.success(`Accepted ${accepted} ${noun}${accepted === 1 ? "" : "s"}`);
            else if (accepted) toast.warning(`Accepted ${accepted}, ${ids.length - accepted} could not be accepted`, { description: errorMessage(failed.reason) });
            else toast.error(feedbackError(errorMessage(failed.reason), "Action couldn’t finish"));
        } finally {
            invalidate();
            setIsBatchBusy(false);
        }
    };

    const handleAcceptAllConnections = () => acceptEach(pendingConnections.map((req) => req.id), (id) => acceptRequest.mutateAsync(id), "connection request");

    const handleAcceptAllInvites = () => acceptEach(pendingInvites.map((inv) => inv.id), (id) => resolveWorkspaceInvitationAction({ invitationId: id, action: "accept" }).then(unwrap), "workspace invite");

    /** One confirmation, then one result per application: what was accepted, what was not, and why. */
    const handleAcceptAllIncoming = async () => {
        if (isBatchBusy || pendingIncoming.length === 0) return;
        setConfirmAcceptAll(false);
        setIsBatchBusy(true);
        try {
            const outcome = await acceptApplicationsAction(pendingIncoming.map((app) => app.id));
            const accepted = outcome.results.filter((item) => item.success).length;
            const failed = outcome.results.filter((item) => !item.success);
            onHandled?.(accepted);
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
        return <MyWorkRequestsSkeleton />;
    }

    if (error || connectionsQuery.error || (data && !data.success)) {
        return (
            <div className="nb-mw-error">
                Couldn’t load your requests.
                <button type="button" onClick={() => { void query.refetch(); void connectionsQuery.refetch(); }}>Try again</button>
            </div>
        );
    }

    const hasAnyRequests = hasOrgRequests || pendingConnections.length > 0 || pendingInvites.length > 0 || pendingIncoming.length > 0;

    if (!hasAnyRequests) {
        return (
            <div className="nb-empty-state nb-grid-ground nb-mw-empty nb-mw-caught" style={{ ["--n" as string]: 3 }}>
                <span className="nb-mw-fig"><PixelPerson identityKey="my-work-waiting" size={54} /></span>
                <b>No requests waiting</b>
                <span>Connection requests, invitations and people asking to join your workspaces show up here the moment they arrive.</span>
            </div>
        );
    }

    const sectionHead = (title: string, count: number, all?: { label: string; onClick: () => void }) => (
        <div className="nb-mw-sec-h">
            {title} · <b>{count}</b>
            {all && count > 1 ? <button type="button" className="nb-mw-link" disabled={isBatchBusy} onClick={all.onClick}>{isBatchBusy ? "Accepting…" : all.label}</button> : null}
        </div>
    );

    return (
        <div id="workspace-requests-panel" role="tabpanel" aria-labelledby="workspace-requests-tab" className="grid gap-[14px]">
            <p className="nb-mw-lead" style={{ ["--n" as string]: 1 }}>
                Connection and workspace decisions that need your attention, in one place.
            </p>
            <OrgRequestsSection compact joinRequests="decide" onNavigate={() => setMyWorkOpen(false)} enabled={isMyWorkOpen && isActive} />
            {pendingConnections.length > 0 && (
                <section className="nb-mw-sec" style={{ ["--n" as string]: 3 }}>
                    {sectionHead("Connection requests", pendingConnections.length, { label: "Accept all", onClick: () => void handleAcceptAllConnections() })}
                    {pendingConnections.map((request) => {
                        const isAccepting = acceptRequest.isPending && acceptRequest.variables === request.id;
                        const isRejecting = rejectRequest.isPending && rejectRequest.variables?.id === request.id;
                        const busy = isAccepting || isRejecting || isBatchBusy;
                        const person = { id: request.requesterId, username: request.requesterUsername, fullName: request.requesterFullName, avatarUrl: request.requesterAvatarUrl };
                        return (
                            <RequestRow
                                key={request.id}
                                avatar={<UserAvatar identity={person} size={28} className="size-7" roundedClassName="rounded-md" />}
                                name={request.requesterFullName || request.requesterUsername || "Someone"}
                                href={profileHref(person)}
                                handle={request.requesterUsername}
                                what={request.requesterHeadline || request.requesterLocation || "Wants to connect"}
                                note={request.message}
                                done={done.get(request.id)}
                            >
                                <Button size="sm" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => void resolveConnection(request.id, "accept")}>Accept</Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs text-muted-foreground" disabled={busy} onClick={() => void resolveConnection(request.id, "reject")}>Decline</Button>
                            </RequestRow>
                        );
                    })}
                </section>
            )}
            {pendingInvites.length > 0 && (
                <section className="nb-mw-sec" style={{ ["--n" as string]: 4 }}>
                    {sectionHead("Workspace invitations", pendingInvites.length, { label: "Accept all", onClick: () => void handleAcceptAllInvites() })}
                    {pendingInvites.map((invite) => {
                        const isAccepting = acceptInvite.isPending && acceptInvite.variables === invite.id;
                        const isRejecting = rejectInvite.isPending && rejectInvite.variables === invite.id;
                        const busy = isAccepting || isRejecting || isBatchBusy;
                        const inviter = invite.actor ?? invite.applicant;
                        return (
                            <RequestRow
                                key={invite.id}
                                avatar={<WorkspaceAvatar project={{ id: invite.projectId ?? undefined, title: invite.projectTitle, coverImage: null }} size="row" className="size-7 rounded-md border-0 ring-0" />}
                                name={invite.projectTitle}
                                href={`/workspaces/${invite.projectSlug || invite.projectId}`}
                                what={<><b>{inviter.fullName || inviter.username || "Someone"}</b> invited you · as {invite.roleTitle}</>}
                                done={done.get(invite.id)}
                            >
                                <Button size="sm" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => acceptInvite.mutate(invite.id)} aria-label={`Accept workspace invitation to ${invite.projectTitle}`}>Accept</Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs text-muted-foreground" disabled={busy} onClick={() => rejectInvite.mutate(invite.id)} aria-label={`Decline workspace invitation to ${invite.projectTitle}`}>Decline</Button>
                            </RequestRow>
                        );
                    })}
                </section>
            )}

            {pendingIncoming.length > 0 && (
                <section className="nb-mw-sec" style={{ ["--n" as string]: 5 }}>
                    {sectionHead("Applications to your workspaces", pendingIncoming.length, { label: `Accept these ${pendingIncoming.length}`, onClick: () => setConfirmAcceptAll(true) })}
                    {pendingIncoming.map((app) => {
                        const applicant = app.applicant ?? {};
                        const name = personCardName(applicant);
                        const writing = accepting?.id === app.id;
                        return (
                            <RequestRow
                                key={app.id}
                                avatar={<UserAvatar identity={applicant} size={28} className="size-7" roundedClassName="rounded-md" />}
                                name={name}
                                href={profileHref(applicant)}
                                handle={applicant.username}
                                what={<>wants to join <b>{app.projectTitle}</b> as {app.roleTitle}{app.channelId ? <> · <Link href={conversationHref(app.channelId)} className="nb-mw-noteb">cover letter</Link></> : null}</>}
                                done={done.get(app.id)}
                                extra={writing ? (
                                    <form className="nb-mw-note" onSubmit={async (event) => {
                                        event.preventDefault();
                                        const failure = await acceptApp(app, { note: welcome });
                                        if (failure) toast.error(feedbackError(failure, "Couldn’t accept"));
                                        else { setAccepting(null); setWelcome(""); }
                                    }}>
                                        <label htmlFor={`nb-mw-welcome-${app.id}`}>Add a welcome note for {name.split(" ")[0]} (optional). Everyone in {app.projectTitle} is told they joined.</label>
                                        <textarea id={`nb-mw-welcome-${app.id}`} autoFocus value={welcome} onChange={(event) => setWelcome(event.target.value)} placeholder="Glad to have you." maxLength={1000} />
                                        <span className="acts"><Button type="submit" size="sm" className="h-7 px-2.5 text-xs">Accept</Button><Button type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={() => { setAccepting(null); setWelcome(""); }}>Cancel</Button></span>
                                    </form>
                                ) : null}
                            >
                                {writing ? null : <>
                                    <Button size="sm" className="h-7 px-2.5 text-xs" disabled={isBatchBusy} onClick={() => { setWelcome(""); setAccepting(app); }} aria-label={`Accept application from ${name} for ${app.projectTitle}`}>Accept</Button>
                                    <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs text-muted-foreground" disabled={isBatchBusy} onClick={() => setDeclining(app)} aria-label={`Decline application from ${name} for ${app.projectTitle}`}>Decline</Button>
                                </>}
                            </RequestRow>
                        );
                    })}
                </section>
            )}
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
                description="This list shows your 20 newest applications. Each person joins their workspace right away, and everyone is told. Decline any you are unsure about first."
                confirmLabel={`Accept these ${pendingIncoming.length}`}
                onConfirm={() => void handleAcceptAllIncoming()}
            />
            {hasAnyRequests ? (
                <Link
                    href="/network?tab=invitations"
                    onClick={() => setMyWorkOpen(false)}
                    className="nb-mw-link w-fit"
                >
                    View all invitations
                </Link>
            ) : null}
        </div>
    );
}
