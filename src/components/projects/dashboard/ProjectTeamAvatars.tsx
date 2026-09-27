"use client";

import Link from "next/link";
import { memo, useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { profileHref } from "@/lib/routing/identifiers";
import { buildProjectPersonReference, formatProjectTeamRole } from "@/lib/projects/settings-policies";

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
                    ? `${guidance.label || "Guide"} · Co-leader`
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
            <div className="flex -space-x-1.5" aria-label="Loading project team">
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
            <div className="flex items-center -space-x-1.5" aria-label={`${avatars.length} project team ${avatars.length === 1 ? "member" : "members"}`}>
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
                            <span tabIndex={0} className="nb-avatar-trigger relative z-10 flex size-[34px] items-center justify-center rounded-[5px] border-2 border-card bg-muted font-mono text-[11px] font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                                +{remaining}
                            </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">{remaining} more team {remaining === 1 ? "member" : "members"}</TooltipContent>
                    </Tooltip>
                ) : null}
            </div>
        </TooltipProvider>
    );
});

export default ProjectTeamAvatars;
