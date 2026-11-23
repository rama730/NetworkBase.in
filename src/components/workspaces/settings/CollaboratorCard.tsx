'use client';

import { useState } from "react";
import {
    Ban,
    Bell,
    BellOff,
    CheckCircle2,
    ChevronDown,
    Crown,
    Eye,
    ShieldCheck,
    UserMinus,
    Users,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useBlockedIds, useMutedIds } from "@/components/messages/ChatShellProvider";
import { BlockPersonDialog, useMuteToggle } from "@/components/privacy/BlockDialog";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    buildWorkspaceMemberMutationPolicy,
    buildWorkspacePersonReference,
    getWorkspaceMemberDisplayName,
    getWorkspaceMemberRoleLabel,
    type WorkspaceMemberRole,
    type WorkspaceSettingsMember,
} from "@/lib/workspaces/settings-policies";
import { formatJoinedAt } from '@/components/workspaces/settings/FileAccessMembers';
import { completeMemberPartAction, decideCompletionAction, undoMemberJourneyAction } from "@/app/actions/workspace/member-journey";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { feedbackError, toast } from "@/lib/feedback";

export function projectMemberRole(member: WorkspaceSettingsMember, ownerId: string | null) {
    if (member.membershipRole) return member.membershipRole;
    return ownerId && member.id === ownerId ? "owner" : "member";
}

function responsibilityHints(member: WorkspaceSettingsMember) {
    const counts = member.responsibilityCounts;
    if (!counts) return [];
    return [
        counts.activeAssignedTasks > 0 ? `${counts.activeAssignedTasks} active assigned` : null,
        counts.activeCreatedTasks > 0 ? `${counts.activeCreatedTasks} created active` : null,
        counts.fileReviews > 0 ? `${counts.fileReviews} file review` : null,
        counts.acceptedApplications > 0 ? `${counts.acceptedApplications} accepted role` : null,
        counts.projectGroupParticipant ? "Workspace channel" : null,
    ].filter((item): item is string => Boolean(item));
}

export function CollaboratorCard({
    member,
    ownerId,
    isProjectOwner,
    actorRole,
    disabled = false,
    onRoleChange,
    onRemove,
    onRemoveAndBlock,
    onTransfer,
    onNotificationSettings,
    projectId,
    onCompletionChanged,
}: {
    member: WorkspaceSettingsMember;
    ownerId: string | null;
    isProjectOwner: boolean;
    actorRole: WorkspaceMemberRole;
    disabled?: boolean;
    onRoleChange: (member: WorkspaceSettingsMember, role: Exclude<WorkspaceMemberRole, "owner">) => void;
    onRemove: (member: WorkspaceSettingsMember) => void | Promise<void>;
    onRemoveAndBlock?: (member: WorkspaceSettingsMember) => void | Promise<void>;
    onTransfer: (member: WorkspaceSettingsMember) => void;
    onNotificationSettings: (member: WorkspaceSettingsMember) => void | Promise<void>;
    /** Member settings §3: completing someone's part, and Confirm or Not yet on a completed part. */
    projectId?: string;
    onCompletionChanged?: () => void;
}) {
    const role = projectMemberRole(member, ownerId) as WorkspaceMemberRole;
    const reference = buildWorkspacePersonReference({
        person: {
            id: member.id,
            fullName: getWorkspaceMemberDisplayName(member),
            username: member.username ?? null,
            avatarUrl: member.avatarUrl ?? null,
        },
        membershipRole: role,
        isActiveMember: true,
    });
    const mutationPolicy = buildWorkspaceMemberMutationPolicy({
        actorIsOwner: isProjectOwner,
        actorRole,
        ownerId,
        targetUserId: member.id,
        targetRole: role,
    });
    const hints = responsibilityHints(member);
    const { user } = useAuth();
    const isSelf = user?.id === member.id;
    const displayName = getWorkspaceMemberDisplayName(member);
    const blockedByMe = useBlockedIds().has(member.id);
    const mutedIds = useMutedIds();
    const toggleMute = useMuteToggle();
    // Each ask mounts a fresh confirmation; nothing is in the tree until then.
    const [blockAsk, setBlockAsk] = useState(0);
    const roleOptions: Array<Exclude<WorkspaceMemberRole, "owner">> = ["admin", "member", "viewer"];
    const completion = member.completion ?? null;
    // The owner for anyone; an admin for members and viewers (report §3 "The owner completes someone's part").
    const leads = isProjectOwner || (actorRole === "admin" && role !== "admin");
    const canComplete = Boolean(projectId) && !isSelf && role !== "owner" && !completion && leads;
    const canDecide = Boolean(projectId) && !isSelf && Boolean(completion) && !completion?.confirmed && (isProjectOwner || actorRole === "admin");
    const [completeAsk, setCompleteAsk] = useState(false);
    const [notYetAsk, setNotYetAsk] = useState(false);
    const [note, setNote] = useState("");
    const [taskChoice, setTaskChoice] = useState<"keep" | "unassign">("keep");
    const [error, setError] = useState<string | null>(null);
    const decide = async (decision: "confirm" | "not_yet", text?: string) => {
        const r = await decideCompletionAction(projectId!, member.id, decision, text ?? null);
        if (!r.success) { toast.error(feedbackError(r.error, "Couldn’t save your answer")); return false; }
        toast.success(decision === "confirm" ? `Confirmed ${displayName}’s part` : `Asked ${displayName} to reopen their part`);
        onCompletionChanged?.();
        return true;
    };

    return (
        <article className="flex min-w-0 flex-col justify-between border-b border-border py-4">
            <div>
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                        <UserAvatar
                            identity={{
                                id: member.id,
                                fullName: reference.displayName,
                                username: member.username ?? null,
                                avatarUrl: reference.avatarUrl,
                            }}
                            size={44}
                            roundedClassName="rounded-[5px]"
                            className="border border-border shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <p className="nb-ui-label break-words text-foreground">{reference.displayName}</p>
                                <span
                                    className={cn(
                                        "h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none shrink-0 inline-flex items-center border",
                                        role === "owner"
                                            ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                            : role === "admin"
                                                ? "border-primary/20 bg-primary/10 text-primary"
                                                : role === "viewer"
                                                    ? "border-border bg-muted/60 text-muted-foreground"
                                                    : "border-border bg-muted text-foreground",
                                    )}
                                >
                                    {reference.roleLabel}
                                </span>
                                {member.outsideOf ? (
                                    <span className="h-5 px-[7px] rounded-[3px] text-[11px] leading-none shrink-0 inline-flex items-center border border-border bg-muted/60 text-muted-foreground">
                                        Outside {member.outsideOf}
                                    </span>
                                ) : null}
                                {completion ? (
                                    <span data-member-completed className="h-5 px-[7px] rounded-[3px] text-[11px] leading-none shrink-0 inline-flex items-center gap-1 border border-border bg-muted/60 text-muted-foreground">
                                        <CheckCircle2 className="size-3" aria-hidden="true" />
                                        Completed · {new Date(completion.at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}{completion.confirmed ? " · confirmed" : ""}
                                    </span>
                                ) : null}
                                {blockedByMe ? (
                                    <span className="nb-tag shrink-0 text-[11px]">Blocked</span>
                                ) : null}
                                {!reference.isAssignable ? (
                                    <span className="h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none shrink-0 inline-flex items-center border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                                        Can’t be assigned tasks
                                    </span>
                                ) : null}
                            </div>
                            <p className="nb-compact mt-1 truncate text-xs text-muted-foreground">
                                {member.projectRoleTitle || (member.username ? `@${member.username}` : member.id)}
                            </p>
                            <p className="nb-meta mt-0.5 text-[11px] text-muted-foreground/80">{formatJoinedAt(member.joinedAt)}</p>
                            {completion?.note ? <p className="nb-compact mt-1 text-xs text-muted-foreground">&ldquo;{completion.note}&rdquo;</p> : null}
                            {canDecide ? (
                                <div className="mt-2 flex gap-2">
                                    <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void decide("confirm")}>Confirm</Button>
                                    <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => { setNote(""); setNotYetAsk(true); }}>Not yet</Button>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                disabled={disabled}
                                variant="outline"
                                size="sm"
                                className="nb-touch-target h-[28px] gap-1 rounded-[5px] border-border px-2.5 text-xs font-medium text-foreground shrink-0 hover:bg-muted"
                            >
                                Actions
                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                            {role !== "owner" ? (
                                roleOptions.map((option) => {
                                    const optionPolicy = buildWorkspaceMemberMutationPolicy({
                                        actorIsOwner: isProjectOwner,
                                        actorRole,
                                        ownerId,
                                        targetUserId: member.id,
                                        targetRole: role,
                                        nextRole: option,
                                    });
                                    return (
                                        <DropdownMenuItem
                                            key={option}
                                            disabled={disabled || !optionPolicy.canChangeRole || role === option || Boolean(completion)}
                                            onClick={() => onRoleChange(member, option)}
                                            className="gap-2 text-xs"
                                        >
                                            {option === "admin" ? (
                                                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                                            ) : option === "viewer" ? (
                                                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                            ) : (
                                                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                            )}
                                            <span>Change access level to {getWorkspaceMemberRoleLabel(option)}</span>
                                            {role === option ? (
                                                <span className="ml-auto text-[10px] max-md:text-[11px] text-muted-foreground">(Current)</span>
                                            ) : null}
                                        </DropdownMenuItem>
                                    );
                                })
                            ) : (
                                <DropdownMenuItem disabled className="gap-2 text-xs">
                                    <Crown className="h-3.5 w-3.5 text-amber-500" />
                                    <span>Owner</span>
                                </DropdownMenuItem>
                            )}

                            <DropdownMenuSeparator />

                            {mutationPolicy.canTransferOwnership ? (
                                <DropdownMenuItem
                                    disabled={disabled}
                                    onClick={() => onTransfer(member)}
                                    className="gap-2 text-xs text-foreground"
                                >
                                    <Crown className="h-3.5 w-3.5 text-amber-500" />
                                    <span>Transfer ownership</span>
                                </DropdownMenuItem>
                            ) : null}

                            {canComplete ? (
                                <DropdownMenuItem disabled={disabled} onClick={() => { setNote(""); setTaskChoice("keep"); setError(null); setCompleteAsk(true); }} className="gap-2 text-xs text-foreground">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span>Complete their part</span>
                                </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem
                                disabled={disabled}
                                    onClick={() => void onNotificationSettings(member)}
                                className="gap-2 text-xs text-foreground"
                            >
                                <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Notification settings</span>
                            </DropdownMenuItem>

                            {mutationPolicy.canRemove ? (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        disabled={disabled}
                                    onClick={() => void onRemove(member)}
                                        className="gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                                    >
                                        <UserMinus className="h-3.5 w-3.5" />
                                        <span>Remove member</span>
                                    </DropdownMenuItem>
                                    {isProjectOwner && onRemoveAndBlock ? (
                                        <DropdownMenuItem disabled={disabled} onClick={() => void onRemoveAndBlock(member)} className="gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive">
                                            <UserMinus className="h-3.5 w-3.5" />
                                            <span>Remove and block from this workspace</span>
                                        </DropdownMenuItem>
                                    ) : null}
                                </>
                            ) : null}
                            {/* A personal block and mute, yours alone: nothing changes about their place here (Blocking B51, B26). */}
                            {!isSelf ? (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => setBlockAsk((n) => n + 1)} className="gap-2 text-xs text-foreground">
                                        <Ban className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span>{blockedByMe ? `Unblock ${displayName}` : `Block ${displayName}`}</span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => toggleMute({ id: member.id, name: displayName }, !mutedIds.has(member.id))} className="gap-2 text-xs text-foreground">
                                        <BellOff className="h-3.5 w-3.5 text-muted-foreground" />
                                        <span>{mutedIds.has(member.id) ? `Unmute ${displayName}` : `Mute ${displayName}`}</span>
                                    </DropdownMenuItem>
                                </>
                            ) : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {hints.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/40 pt-3">
                        {hints.map((hint) => (
                            <span
                                key={hint}
                                className="nb-tag text-[11px] py-0.5 px-2 font-normal text-muted-foreground"
                            >
                                {hint}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
            {completeAsk ? (
                <ConfirmDialog open onOpenChange={(o) => { if (!o) setCompleteAsk(false); }} title={`Complete ${displayName}’s part?`}
                    description={`They stay a member, read-only, and are told. Their profile says you marked it completed; they can reopen it.`}
                    confirmLabel="Complete their part" autoCloseOnConfirm={false} errorMessage={error ?? undefined}
                    onConfirm={async () => {
                        const r = await completeMemberPartAction(projectId!, member.id, { note: note.trim() || null, tasks: taskChoice });
                        if (!r.success) { setError(r.error); return; }
                        setCompleteAsk(false);
                        onCompletionChanged?.();
                        const undoId = (r.data as { undoId?: string | null }).undoId;
                        toast(`${displayName}’s part is completed`, undoId ? { duration: 10_000, action: { label: "Undo", onClick: async () => {
                            const u = await undoMemberJourneyAction(undoId);
                            if (u.success) { toast.success("Undone"); onCompletionChanged?.(); } else toast.error(feedbackError(u.error, "Couldn’t undo"));
                        } } } : undefined);
                    }}>
                    <div className="space-y-3">
                        <fieldset className="space-y-1.5">
                            <legend className="nb-micro text-muted-foreground">Their open tasks</legend>
                            {(["keep", "unassign"] as const).map((c) => (
                                <label key={c} className="flex items-center gap-2.5">
                                    <input type="radio" className="nb-radio" name={`complete-tasks-${member.id}`} checked={taskChoice === c} onChange={() => setTaskChoice(c)} />
                                    <span className="nb-compact">{c === "keep" ? "Keep them assigned" : "Unassign them"}</span>
                                </label>
                            ))}
                        </fieldset>
                        <textarea aria-label="Note (optional)" placeholder="Note (optional)" className="nb-input min-h-[64px] w-full" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>
                </ConfirmDialog>
            ) : null}
            {notYetAsk ? (
                <ConfirmDialog open onOpenChange={(o) => { if (!o) setNotYetAsk(false); }} title={`Not yet for ${displayName}?`}
                    description="They get your note and are asked to reopen their part. Nothing reopens on its own." confirmLabel="Send"
                    onConfirm={async () => { if (await decide("not_yet", note.trim())) setNotYetAsk(false); }}>
                    <textarea aria-label="What’s left" placeholder="What’s left (optional)" className="nb-input min-h-[64px] w-full" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                </ConfirmDialog>
            ) : null}
            {blockAsk ? <BlockPersonDialog key={blockAsk} person={{ id: member.id, name: displayName }} source="member_list" unblock={blockedByMe} /> : null}
        </article>
    );
}
