"use client";

import Link from "next/link";
import { memo, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { profileHref } from "@/lib/routing/identifiers";
import { buildProjectPersonReference, formatProjectTeamRole } from "@/lib/workspaces/settings-policies";

export interface ProjectHeaderMember {
    id: string;
    fullName?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
    projectRoleTitle?: string | null;
    membershipRole?: string | null;
    joinedAt?: string | null;
}

interface ProjectTeamAvatarsProps {
    project: any;
    members?: ProjectHeaderMember[];
    loading?: boolean;
}

type HeaderAvatar = {
    id: string;
    name: string;
    role: string;
    avatarUrl: string | null;
    username: string | null;
    canOpenProfile: boolean;
};

const initials = (name: string) => name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

const ProjectTeamAvatars = memo(function ProjectTeamAvatars({
    project,
    members = [],
    loading = false,
}: ProjectTeamAvatarsProps) {
    const [rosterOpen, setRosterOpen] = useState(false);
    const avatars = useMemo<HeaderAvatar[]>(() => {
        const owner = project?.owner;
        const guidance = project?.guidance;
        const leadFocus = typeof project?.importSource?.metadata?.leadFocus === "string"
            ? project.importSource.metadata.leadFocus.trim()
            : "";
        const memberList = members.filter((member) => member?.id !== owner?.id);
        const guideMember = guidance?.guideUserId
            ? memberList.find((member) => member.id === guidance.guideUserId) ?? {
                id: guidance.guideUserId,
                fullName: guidance.fullName,
                username: guidance.username,
                avatarUrl: guidance.avatarUrl,
                membershipRole: "admin",
            }
            : null;
        const people = [
            ...(owner?.id ? [owner] : []),
            ...(guideMember ? [guideMember] : []),
            ...memberList.filter((member) => member.id !== guideMember?.id),
        ];

        return people
            .filter((member, index, list) => member?.id && list.findIndex((candidate) => candidate?.id === member.id) === index)
            .map((member) => {
                const isOwner = member.id === owner?.id;
                const reference = buildProjectPersonReference({
                    person: member,
                    membershipRole: isOwner ? "owner" : member.membershipRole,
                    isActiveMember: true,
                });
                const role = member.id === guidance?.guideUserId
                    ? `${guidance.label || "Mentor"} · Admin`
                    : formatProjectTeamRole({
                        membershipRole: isOwner ? "owner" : member.membershipRole,
                        projectRoleTitle: member.projectRoleTitle,
                        leadFocus: isOwner ? leadFocus : undefined,
                    });

                return {
                    id: member.id,
                    name: reference.displayName,
                    role: role || reference.roleLabel || "Team member",
                    avatarUrl: reference.avatarUrl,
                    username: member.username ?? null,
                    canOpenProfile: reference.canOpenProfile,
                };
            });
    }, [members, project]);

    if (loading && avatars.length === 0) {
        return (
            <div className="flex -space-x-1.5" aria-label="Loading workspace team">
                {Array.from({ length: 3 }).map((_, index) => (
                    <span key={index} className="size-[34px] rounded-[5px] border-2 border-card bg-muted" />
                ))}
            </div>
        );
    }

    if (avatars.length === 0) return null;

    const visibleAvatars = avatars.slice(0, 5);
    const remaining = avatars.length - visibleAvatars.length;

    return (
        <TooltipProvider delayDuration={130}>
            {/* Below md the stack is decorative; the members button opens the roster (tooltips never show on touch). */}
            <div className="flex items-center -space-x-1.5 max-md:pointer-events-none max-md:[&_.nb-avatar-trigger]:min-h-0 max-md:[&_.nb-avatar-trigger]:min-w-0" aria-label={`${avatars.length} workspace team ${avatars.length === 1 ? "member" : "members"}`}>
                {visibleAvatars.map((avatar) => {
                    const portrait = (
                        <Avatar className="size-[34px] rounded-[5px] border-2 border-card bg-muted shadow-none">
                            <AvatarImage src={avatar.avatarUrl ?? undefined} alt="" className="object-cover" />
                            <AvatarFallback identityKey={avatar.id} className="rounded-[5px] font-mono text-[11px] font-semibold text-muted-foreground">
                                {initials(avatar.name)}
                            </AvatarFallback>
                        </Avatar>
                    );
                    const trigger = avatar.username && avatar.canOpenProfile ? (
                        <Link
                            href={profileHref({ id: avatar.id, username: avatar.username })}
                            aria-label={`Open ${avatar.name}'s profile`}
                            className="nb-avatar-trigger relative inline-flex rounded-[5px] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            {portrait}
                        </Link>
                    ) : (
                        <span tabIndex={0} className="nb-avatar-trigger relative inline-flex rounded-[5px] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                            {portrait}
                        </span>
                    );

                    return (
                        <Tooltip key={avatar.id}>
                            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                            <TooltipContent side="bottom" className="space-y-1">
                                <p className="font-semibold">{avatar.name}</p>
                                <p className="text-[11px] font-normal">{avatar.role}</p>
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
                {remaining > 0 ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                onClick={() => setRosterOpen(true)}
                                aria-label={`View all ${avatars.length} team members`}
                                className="nb-avatar-trigger relative z-10 flex size-[34px] items-center justify-center rounded-[5px] border-2 border-card bg-muted font-mono text-[11px] font-semibold text-muted-foreground hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 cursor-pointer transition-colors"
                            >
                                +{remaining}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{remaining} more team {remaining === 1 ? "member" : "members"}</TooltipContent>
                    </Tooltip>
                ) : null}
            </div>
            <button
                type="button"
                onClick={() => setRosterOpen(true)}
                className="nb-touch-target nb-ui-label inline-flex items-center rounded-[5px] px-1 text-muted-foreground hover:text-foreground cursor-pointer md:hidden"
            >
                {avatars.length} {avatars.length === 1 ? "member" : "members"}
            </button>
            <Dialog open={rosterOpen} onOpenChange={setRosterOpen}>
                <DialogContent presentation="right-drawer" className="gap-0 p-0 sm:max-w-[360px]">
                    <DialogTitle className="nb-card-title border-b border-border px-4 py-4">Team</DialogTitle>
                    <ul className="app-scroll app-scroll-y flex-1 divide-y divide-border overflow-y-auto">
                        {avatars.map((avatar) => (
                            <li key={avatar.id}>
                                {avatar.username && avatar.canOpenProfile ? (
                                    <Link href={profileHref({ id: avatar.id, username: avatar.username })} onClick={() => setRosterOpen(false)} className="flex min-h-14 items-center gap-3 px-4 py-2">
                                        <RosterRow avatar={avatar} />
                                    </Link>
                                ) : (
                                    <div className="flex min-h-14 items-center gap-3 px-4 py-2"><RosterRow avatar={avatar} /></div>
                                )}
                            </li>
                        ))}
                    </ul>
                </DialogContent>
            </Dialog>
        </TooltipProvider>
    );
});

function RosterRow({ avatar }: { avatar: HeaderAvatar }) {
    return (
        <>
            <Avatar className="size-[34px] shrink-0 rounded-[5px] bg-muted">
                <AvatarImage src={avatar.avatarUrl ?? undefined} alt="" className="object-cover" />
                <AvatarFallback identityKey={avatar.id} className="rounded-[5px] font-mono text-[11px] font-semibold text-muted-foreground">
                    {initials(avatar.name)}
                </AvatarFallback>
            </Avatar>
            <span className="min-w-0">
                <span className="nb-ui-label block truncate text-foreground">{avatar.name}</span>
                <span className="nb-compact block truncate text-muted-foreground">{avatar.role}</span>
            </span>
        </>
    );
}

export default ProjectTeamAvatars;
