"use server";

import * as commonImpl from "@/lib/projects/server/common";
import * as detailImpl from "@/lib/projects/server/detail";
import * as lifecycleImpl from "@/lib/projects/server/lifecycle";
import * as accessImpl from "@/lib/projects/server/access";
import * as settingsImpl from "@/lib/projects/server/settings";
import * as tasksImpl from "@/lib/projects/server/tasks";
import * as sprintsImpl from "@/lib/projects/server/sprints";
export type { ProjectDetailShellResult } from "@/lib/projects/server/detail";
export type { ProjectDetailMetadataRead } from "@/lib/projects/server/detail";

export async function invalidateProjectPublicCaches(...args: Parameters<typeof commonImpl.invalidateProjectPublicCaches>): ReturnType<typeof commonImpl.invalidateProjectPublicCaches> {
  return commonImpl.invalidateProjectPublicCaches(...args);
}

export async function readProjectDetailMetadata(...args: Parameters<typeof detailImpl.readProjectDetailMetadata>): ReturnType<typeof detailImpl.readProjectDetailMetadata> {
  return detailImpl.readProjectDetailMetadata(...args);
}

export async function readProjectDetailShell(...args: Parameters<typeof detailImpl.readProjectDetailShell>): ReturnType<typeof detailImpl.readProjectDetailShell> {
  return detailImpl.readProjectDetailShell(...args);
}

export async function createProjectAction(...args: Parameters<typeof lifecycleImpl.createProjectAction>): ReturnType<typeof lifecycleImpl.createProjectAction> {
  return lifecycleImpl.createProjectAction(...args);
}

export async function updateProject(...args: Parameters<typeof lifecycleImpl.updateProject>): ReturnType<typeof lifecycleImpl.updateProject> {
  return lifecycleImpl.updateProject(...args);
}

export async function createProjectCoverImageUploadUrlAction(...args: Parameters<typeof lifecycleImpl.createProjectCoverImageUploadUrlAction>): ReturnType<typeof lifecycleImpl.createProjectCoverImageUploadUrlAction> {
  return lifecycleImpl.createProjectCoverImageUploadUrlAction(...args);
}

export async function finalizeProjectCoverImageUploadAction(...args: Parameters<typeof lifecycleImpl.finalizeProjectCoverImageUploadAction>): ReturnType<typeof lifecycleImpl.finalizeProjectCoverImageUploadAction> {
  return lifecycleImpl.finalizeProjectCoverImageUploadAction(...args);
}

export async function clearProjectCoverImageAction(...args: Parameters<typeof lifecycleImpl.clearProjectCoverImageAction>): ReturnType<typeof lifecycleImpl.clearProjectCoverImageAction> {
  return lifecycleImpl.clearProjectCoverImageAction(...args);
}

export async function updateProjectExternalLinksAction(...args: Parameters<typeof lifecycleImpl.updateProjectExternalLinksAction>): ReturnType<typeof lifecycleImpl.updateProjectExternalLinksAction> {
  return lifecycleImpl.updateProjectExternalLinksAction(...args);
}

export async function getProjectAccessTransitionPreflightAction(...args: Parameters<typeof accessImpl.getProjectAccessTransitionPreflightAction>): ReturnType<typeof accessImpl.getProjectAccessTransitionPreflightAction> {
  return accessImpl.getProjectAccessTransitionPreflightAction(...args);
}

export async function updateProjectVisibilityAction(...args: Parameters<typeof accessImpl.updateProjectVisibilityAction>): ReturnType<typeof accessImpl.updateProjectVisibilityAction> {
  return accessImpl.updateProjectVisibilityAction(...args);
}

export async function getProjectAccessImpactAction(...args: Parameters<typeof accessImpl.getProjectAccessImpactAction>): ReturnType<typeof accessImpl.getProjectAccessImpactAction> {
  return accessImpl.getProjectAccessImpactAction(...args);
}

export async function updateProjectPublicTabVisibilityAction(...args: Parameters<typeof accessImpl.updateProjectPublicTabVisibilityAction>): ReturnType<typeof accessImpl.updateProjectPublicTabVisibilityAction> {
  return accessImpl.updateProjectPublicTabVisibilityAction(...args);
}

export async function getProjectCollaboratorSettingsAction(...args: Parameters<typeof settingsImpl.getProjectCollaboratorSettingsAction>): ReturnType<typeof settingsImpl.getProjectCollaboratorSettingsAction> {
  return settingsImpl.getProjectCollaboratorSettingsAction(...args);
}

export async function getProjectFileWorkspaceSettingsAction(...args: Parameters<typeof settingsImpl.getProjectFileWorkspaceSettingsAction>): ReturnType<typeof settingsImpl.getProjectFileWorkspaceSettingsAction> {
  return settingsImpl.getProjectFileWorkspaceSettingsAction(...args);
}

export async function updateProjectMemberFileUploadAction(...args: Parameters<typeof settingsImpl.updateProjectMemberFileUploadAction>): ReturnType<typeof settingsImpl.updateProjectMemberFileUploadAction> {
  return settingsImpl.updateProjectMemberFileUploadAction(...args);
}

export async function updateProjectFileUploadDefaultsAction(...args: Parameters<typeof settingsImpl.updateProjectFileUploadDefaultsAction>): ReturnType<typeof settingsImpl.updateProjectFileUploadDefaultsAction> {
  return settingsImpl.updateProjectFileUploadDefaultsAction(...args);
}

export async function readProjectNotificationSettingsAction(...args: Parameters<typeof settingsImpl.readProjectNotificationSettingsAction>): ReturnType<typeof settingsImpl.readProjectNotificationSettingsAction> {
  return settingsImpl.readProjectNotificationSettingsAction(...args);
}

export async function updateProjectNotificationSettingsAction(...args: Parameters<typeof settingsImpl.updateProjectNotificationSettingsAction>): ReturnType<typeof settingsImpl.updateProjectNotificationSettingsAction> {
  return settingsImpl.updateProjectNotificationSettingsAction(...args);
}

export async function resetProjectNotificationSettingsAction(...args: Parameters<typeof settingsImpl.resetProjectNotificationSettingsAction>): ReturnType<typeof settingsImpl.resetProjectNotificationSettingsAction> {
  return settingsImpl.resetProjectNotificationSettingsAction(...args);
}

export async function readProjectMemberNotificationSettingsAction(...args: Parameters<typeof settingsImpl.readProjectMemberNotificationSettingsAction>): ReturnType<typeof settingsImpl.readProjectMemberNotificationSettingsAction> {
  return settingsImpl.readProjectMemberNotificationSettingsAction(...args);
}

export async function updateProjectMemberNotificationSettingsAction(...args: Parameters<typeof settingsImpl.updateProjectMemberNotificationSettingsAction>): ReturnType<typeof settingsImpl.updateProjectMemberNotificationSettingsAction> {
  return settingsImpl.updateProjectMemberNotificationSettingsAction(...args);
}

export async function resetProjectMemberNotificationSettingsAction(...args: Parameters<typeof settingsImpl.resetProjectMemberNotificationSettingsAction>): ReturnType<typeof settingsImpl.resetProjectMemberNotificationSettingsAction> {
  return settingsImpl.resetProjectMemberNotificationSettingsAction(...args);
}

export async function updateProjectMemberRoleAction(...args: Parameters<typeof settingsImpl.updateProjectMemberRoleAction>): ReturnType<typeof settingsImpl.updateProjectMemberRoleAction> {
  return settingsImpl.updateProjectMemberRoleAction(...args);
}

export async function getProjectMemberRemovalPreflightAction(...args: Parameters<typeof settingsImpl.getProjectMemberRemovalPreflightAction>): ReturnType<typeof settingsImpl.getProjectMemberRemovalPreflightAction> {
  return settingsImpl.getProjectMemberRemovalPreflightAction(...args);
}

export async function removeProjectMemberAction(...args: Parameters<typeof settingsImpl.removeProjectMemberAction>): ReturnType<typeof settingsImpl.removeProjectMemberAction> {
  return settingsImpl.removeProjectMemberAction(...args);
}

export async function getProjectDangerZonePreflightAction(...args: Parameters<typeof settingsImpl.getProjectDangerZonePreflightAction>): ReturnType<typeof settingsImpl.getProjectDangerZonePreflightAction> {
  return settingsImpl.getProjectDangerZonePreflightAction(...args);
}

export async function archiveProjectAction(...args: Parameters<typeof lifecycleImpl.archiveProjectAction>): ReturnType<typeof lifecycleImpl.archiveProjectAction> {
  return lifecycleImpl.archiveProjectAction(...args);
}

export async function deleteProject(...args: Parameters<typeof lifecycleImpl.deleteProject>): ReturnType<typeof lifecycleImpl.deleteProject> {
  return lifecycleImpl.deleteProject(...args);
}

export async function deleteProjectDraftAction(...args: Parameters<typeof lifecycleImpl.deleteProjectDraftAction>): ReturnType<typeof lifecycleImpl.deleteProjectDraftAction> {
  return lifecycleImpl.deleteProjectDraftAction(...args);
}

export async function toggleProjectFollowAction(...args: Parameters<typeof lifecycleImpl.toggleProjectFollowAction>): ReturnType<typeof lifecycleImpl.toggleProjectFollowAction> {
  return lifecycleImpl.toggleProjectFollowAction(...args);
}

export async function incrementProjectViewAction(...args: Parameters<typeof lifecycleImpl.incrementProjectViewAction>): ReturnType<typeof lifecycleImpl.incrementProjectViewAction> {
  return lifecycleImpl.incrementProjectViewAction(...args);
}

export async function getProjectHydrationProgressAction(...args: Parameters<typeof detailImpl.getProjectHydrationProgressAction>): ReturnType<typeof detailImpl.getProjectHydrationProgressAction> {
  return detailImpl.getProjectHydrationProgressAction(...args);
}

export async function markTaskAsReadAction(...args: Parameters<typeof tasksImpl.markTaskAsReadAction>): ReturnType<typeof tasksImpl.markTaskAsReadAction> {
  return tasksImpl.markTaskAsReadAction(...args);
}

export async function fetchProjectTasksAction(...args: Parameters<typeof tasksImpl.fetchProjectTasksAction>): ReturnType<typeof tasksImpl.fetchProjectTasksAction> {
  return tasksImpl.fetchProjectTasksAction(...args);
}

export async function fetchProjectLinkPreviewsAction(...args: Parameters<typeof tasksImpl.fetchProjectLinkPreviewsAction>): ReturnType<typeof tasksImpl.fetchProjectLinkPreviewsAction> {
  return tasksImpl.fetchProjectLinkPreviewsAction(...args);
}

export async function fetchProjectTaskPreviewsAction(...args: Parameters<typeof tasksImpl.fetchProjectTaskPreviewsAction>): ReturnType<typeof tasksImpl.fetchProjectTaskPreviewsAction> {
  return tasksImpl.fetchProjectTaskPreviewsAction(...args);
}

export async function fetchProjectSprintsAction(...args: Parameters<typeof sprintsImpl.fetchProjectSprintsAction>): ReturnType<typeof sprintsImpl.fetchProjectSprintsAction> {
  return sprintsImpl.fetchProjectSprintsAction(...args);
}

export async function fetchProjectSprintDetailAction(...args: Parameters<typeof sprintsImpl.fetchProjectSprintDetailAction>): ReturnType<typeof sprintsImpl.fetchProjectSprintDetailAction> {
  return sprintsImpl.fetchProjectSprintDetailAction(...args);
}

export async function fetchProjectSprintTimelinePageAction(...args: Parameters<typeof sprintsImpl.fetchProjectSprintTimelinePageAction>): ReturnType<typeof sprintsImpl.fetchProjectSprintTimelinePageAction> {
  return sprintsImpl.fetchProjectSprintTimelinePageAction(...args);
}

export async function readProjectSprintDetail(...args: Parameters<typeof sprintsImpl.readProjectSprintDetail>): ReturnType<typeof sprintsImpl.readProjectSprintDetail> {
  return sprintsImpl.readProjectSprintDetail(...args);
}

export async function getProjectTaskDetailAction(...args: Parameters<typeof tasksImpl.getProjectTaskDetailAction>): ReturnType<typeof tasksImpl.getProjectTaskDetailAction> {
  return tasksImpl.getProjectTaskDetailAction(...args);
}

export async function getProjectMembersAction(...args: Parameters<typeof tasksImpl.getProjectMembersAction>): ReturnType<typeof tasksImpl.getProjectMembersAction> {
  return tasksImpl.getProjectMembersAction(...args);
}

export async function createTaskAction(...args: Parameters<typeof tasksImpl.createTaskAction>): ReturnType<typeof tasksImpl.createTaskAction> {
  return tasksImpl.createTaskAction(...args);
}

export async function createSprintAction(...args: Parameters<typeof sprintsImpl.createSprintAction>): ReturnType<typeof sprintsImpl.createSprintAction> {
  return sprintsImpl.createSprintAction(...args);
}

export async function updateSprintAction(...args: Parameters<typeof sprintsImpl.updateSprintAction>): ReturnType<typeof sprintsImpl.updateSprintAction> {
  return sprintsImpl.updateSprintAction(...args);
}

export async function deleteSprintAction(...args: Parameters<typeof sprintsImpl.deleteSprintAction>): ReturnType<typeof sprintsImpl.deleteSprintAction> {
  return sprintsImpl.deleteSprintAction(...args);
}

export async function completeSprintAction(...args: Parameters<typeof sprintsImpl.completeSprintAction>): ReturnType<typeof sprintsImpl.completeSprintAction> {
  return sprintsImpl.completeSprintAction(...args);
}

export async function archiveSprintAction(...args: Parameters<typeof sprintsImpl.archiveSprintAction>): ReturnType<typeof sprintsImpl.archiveSprintAction> {
  return sprintsImpl.archiveSprintAction(...args);
}

export async function cancelSprintAction(...args: Parameters<typeof sprintsImpl.cancelSprintAction>): ReturnType<typeof sprintsImpl.cancelSprintAction> {
  return sprintsImpl.cancelSprintAction(...args);
}

export async function deleteTaskAction(...args: Parameters<typeof tasksImpl.deleteTaskAction>): ReturnType<typeof tasksImpl.deleteTaskAction> {
  return tasksImpl.deleteTaskAction(...args);
}

export async function updateProjectStageAction(...args: Parameters<typeof lifecycleImpl.updateProjectStageAction>): ReturnType<typeof lifecycleImpl.updateProjectStageAction> {
  return lifecycleImpl.updateProjectStageAction(...args);
}

export async function updateProjectLifecycleAction(...args: Parameters<typeof lifecycleImpl.updateProjectLifecycleAction>): ReturnType<typeof lifecycleImpl.updateProjectLifecycleAction> {
  return lifecycleImpl.updateProjectLifecycleAction(...args);
}

export async function getProfileProjectsWithOpenRolesAction(...args: Parameters<typeof lifecycleImpl.getProfileProjectsWithOpenRolesAction>): ReturnType<typeof lifecycleImpl.getProfileProjectsWithOpenRolesAction> {
  return lifecycleImpl.getProfileProjectsWithOpenRolesAction(...args);
}

export async function readProjectSettingsBootstrapAction(...args: Parameters<typeof settingsImpl.readProjectSettingsBootstrapAction>): ReturnType<typeof settingsImpl.readProjectSettingsBootstrapAction> {
  return settingsImpl.readProjectSettingsBootstrapAction(...args);
}

