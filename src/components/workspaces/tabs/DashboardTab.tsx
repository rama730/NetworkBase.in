"use client";

import ProjectOverviewCard from "@/components/workspaces/dashboard/WorkspaceOverviewCard";
import OpenRolesCard, { type ApplicationCardControls } from "@/components/workspaces/dashboard/OpenRolesCard";
import JourneyTimeline from "@/components/workspaces/dashboard/JourneyTimeline";
import { RecentActivityCard } from "@/components/workspaces/dashboard/RecentActivityCard";
import { PlannerOverviewCard } from "@/components/workspaces/dashboard/PlannerOverviewCard";
import { BugsOverviewCard } from "@/components/workspaces/dashboard/BugsOverviewCard";
import { RequestsOverviewCard } from "@/components/workspaces/dashboard/RequestsOverviewCard";
import { useBottomStickyRail } from "@/hooks/useBottomStickyRail";

import { type ApplicationStatusResult } from "@/app/actions/applications";
import type { WorkspaceRecentActivityItem } from "@/lib/workspaces/recent-activity";

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
    application?: ApplicationCardControls;
    pendingApplications?: number;
    /** Recent activity's first read, started on the server with the page. */
    recentActivityStarted?: Promise<WorkspaceRecentActivityItem[]>;
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
    application,
    pendingApplications,
    recentActivityStarted,
}: DashboardTabProps) {
    const stickyRail = useBottomStickyRail({ topInset: "calc(var(--workspace-tabs-height, 0px) + 24px)" });
    const stages = lifecycleStages.map((stage: any) => stage?.name ?? stage).filter(Boolean);

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="min-w-0 space-y-6 lg:col-span-8">
                <ProjectOverviewCard project={project} isCreator={isCreator} onEdit={onEdit} />
            </div>

            <aside {...stickyRail} aria-label="Workspace details" className="min-w-0 space-y-6 lg:col-span-4 lg:sticky lg:self-start">
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
                {project.kind !== "organization" ? <PlannerOverviewCard projectId={project.id} slug={project.slug ?? project.id} /> : null}
                {project.kind !== "organization" ? <BugsOverviewCard projectId={project.id} slug={project.slug ?? project.id} /> : null}
                {project.kind !== "organization" ? <RequestsOverviewCard projectId={project.id} slug={project.slug ?? project.id} /> : null}
                <RecentActivityCard projectId={project.id} started={recentActivityStarted} />
                <OpenRolesCard
                    inOrganization={Boolean(project.parentOrg)}
                    roles={rolesWithFilled}
                    isCreator={isCreator}
                    isCollaborator={isCollaborator}
                    applicationStatus={applicationStatus}
                    onApply={onApplyToRole}
                    onManageRoles={onEdit}
                    onAcceptInvitation={onAcceptInvitation}
                    onDeclineInvitation={onDeclineInvitation}
                    invitationLoading={invitationLoading}
                    application={application}
                    pendingApplications={pendingApplications}
                />
            </aside>
        </div>
    );
}

export default DashboardTab;
