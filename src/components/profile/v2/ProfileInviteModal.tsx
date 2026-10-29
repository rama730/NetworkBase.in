"use client";

import InviteCollaboratorModal, { type ParticipationWorkspace } from "@/components/workspaces/dashboard/InviteCollaboratorModal";
import type { ProfileInviteWorkspaceOption } from "@/lib/profile/collaboration";
import { PlainContentHeadings } from "@/components/workspaces/PlainContentHeadings";

interface ProfileInviteModalProps {
    isOpen: boolean;
    onClose: () => void;
    profileId: string;
    profileName: string;
    projects: ProfileInviteWorkspaceOption[];
}

/** Profile entry point for the same Invite Collaborator module used on a Team card. */
export default function ProfileInviteModal({ isOpen, onClose, profileId, profileName, projects }: ProfileInviteModalProps) {
    const projectOptions: ParticipationWorkspace[] = projects.map((project) => ({
        id: project.id,
        title: project.title,
        slug: project.slug,
        role: project.role,
    }));
    return <PlainContentHeadings><InviteCollaboratorModal isOpen={isOpen} onClose={onClose} projects={projectOptions} candidate={{ id: profileId, fullName: profileName, username: null, avatarUrl: null, headline: null }} /></PlainContentHeadings>;
}
