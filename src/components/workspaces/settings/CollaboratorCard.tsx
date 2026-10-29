'use client';

import {
    Bell,
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
    onTransfer,
    onNotificationSettings,
}: {
    member: WorkspaceSettingsMember;
    ownerId: string | null;
    isProjectOwner: boolean;
    actorRole: WorkspaceMemberRole;
    disabled?: boolean;
    onRoleChange: (member: WorkspaceSettingsMember, role: Exclude<WorkspaceMemberRole, "owner">) => void;
    onRemove: (member: WorkspaceSettingsMember) => void | Promise<void>;
    onTransfer: (member: WorkspaceSettingsMember) => void;
    onNotificationSettings: (member: WorkspaceSettingsMember) => void | Promise<void>;
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
    const roleOptions: Array<Exclude<WorkspaceMemberRole, "owner">> = ["admin", "member", "viewer"];

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
                                            disabled={disabled || !optionPolicy.canChangeRole || role === option}
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
        </article>
    );
}
