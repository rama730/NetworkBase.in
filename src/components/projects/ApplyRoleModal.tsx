"use client";

import InviteCollaboratorModal, { type ProjectLead, type ApplySuccessHandler, type EditableApplication, type ParticipationRole } from "@/components/projects/dashboard/InviteCollaboratorModal";
import { PlainContentHeadings } from "@/components/projects/PlainContentHeadings";

type ProjectRef = { id: string; title: string; slug?: string | null };

interface ApplyRoleModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: ApplySuccessHandler;
    /** Edit mode: change the pending application instead of submitting a new one. */
    editApplication?: EditableApplication;
    onRolesStale?: () => void;
    /** The project's lead, so the applicant sees who they are writing to. */
    lead?: ProjectLead;
    project?: ProjectRef;
    roles?: ParticipationRole[];
    preselectedRoleId?: string;
    candidateProjects?: { id: string; title: string; slug?: string | null; openRoles: ParticipationRole[] }[];
}

/** Compatibility entry point: applications now use the Invite Collaborator recruitment surface. */
export default function ApplyRoleModal({ isOpen, onClose, onSuccess, editApplication, onRolesStale, lead, project, roles, preselectedRoleId, candidateProjects }: ApplyRoleModalProps) {
    return <PlainContentHeadings><InviteCollaboratorModal isOpen={isOpen} onClose={onClose} onSuccess={onSuccess} mode="apply" projectId={project?.id} projectTitle={project?.title} roles={roles} projects={candidateProjects} preselectedRoleId={preselectedRoleId} editApplication={editApplication} onRolesStale={onRolesStale} lead={lead} /></PlainContentHeadings>;
}
