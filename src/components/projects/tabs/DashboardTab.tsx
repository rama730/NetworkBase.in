"use client";

import ProjectOverviewCard from "@/components/projects/dashboard/ProjectOverviewCard";
import OpenRolesCard from "@/components/projects/dashboard/OpenRolesCard";
import JourneyTimeline from "@/components/projects/dashboard/JourneyTimeline";
import { RecentActivityCard } from "@/components/projects/dashboard/RecentActivityCard";
import { useBottomStickyRail } from "@/hooks/useBottomStickyRail";

import { type ApplicationStatusResult } from "@/app/actions/applications";

interface DashboardTabProps {
    project: any;
    isCreator: boolean;
    isCollaborator: boolean;
    rolesWithFilled: any[];
    onEdit: () => void;
    onAdvanceStage: () => void;
    onRedoStage?: () => void;
    onApplyToRole: (role: any) => void;
    lifecycleStages: any[];
    currentStageIndex: number;
    applicationStatus?: ApplicationStatusResult;
    onAcceptInvitation?: () => void;
    onDeclineInvitation?: () => void;
    invitationLoading?: boolean;
}

export function DashboardTab({
    project,
    isCreator,
    isCollaborator,
    rolesWithFilled,
    onEdit,
    onAdvanceStage,
    onRedoStage,
    onApplyToRole,
    lifecycleStages,
    currentStageIndex,
    applicationStatus = { status: 'none' },
    onAcceptInvitation,
    onDeclineInvitation,
    invitationLoading,
}: DashboardTabProps) {
    const stickyRail = useBottomStickyRail({ topInset: "calc(var(--project-tabs-height, 0px) + 24px)" });
    const stages = lifecycleStages.map((stage: any) => stage?.name ?? stage).filter(Boolean);

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="min-w-0 space-y-6 lg:col-span-8">
                <ProjectOverviewCard project={project} isCreator={isCreator} onEdit={onEdit} />
            </div>

            <aside {...stickyRail} aria-label="Project details" className="min-w-0 space-y-6 lg:col-span-4 lg:sticky lg:self-start">
                {stages.length > 0 ? (
                    <JourneyTimeline
                        stages={stages}
                        currentStageIndex={currentStageIndex}
                        isCreator={isCreator}
                        onAdvanceStage={onAdvanceStage}
                        onRedoStage={onRedoStage}
                        stageCompletionDates={project?.stageCompletionDates}
                        layout="rail"
                    />
                ) : null}
                <RecentActivityCard projectId={project.id} />
                <OpenRolesCard
                    roles={rolesWithFilled}
                    isCreator={isCreator}
                    isCollaborator={isCollaborator}
                    applicationStatus={applicationStatus}
                    onApply={onApplyToRole}
                    onManageRoles={onEdit}
                    onAcceptInvitation={onAcceptInvitation}
                    onDeclineInvitation={onDeclineInvitation}
                    invitationLoading={invitationLoading}
                />
            </aside>
        </div>
    );
}

export default DashboardTab;
