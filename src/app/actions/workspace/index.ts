"use server";

import * as commonImpl from "@/lib/workspaces/server/common";
import * as detailImpl from "@/lib/workspaces/server/detail";
import * as lifecycleImpl from "@/lib/workspaces/server/lifecycle";
import * as accessImpl from "@/lib/workspaces/server/access";
import * as settingsImpl from "@/lib/workspaces/server/settings";
import * as tasksImpl from "@/lib/workspaces/server/tasks";
import * as sprintsImpl from "@/lib/workspaces/server/sprints";
export type { WorkspaceDetailShellResult } from "@/lib/workspaces/server/detail";
export type { WorkspaceDetailMetadataRead } from "@/lib/workspaces/server/detail";

export async function invalidateWorkspacePublicCaches(...args: Parameters<typeof commonImpl.invalidateWorkspacePublicCaches>): ReturnType<typeof commonImpl.invalidateWorkspacePublicCaches> {
  return commonImpl.invalidateWorkspacePublicCaches(...args);
}

export async function readWorkspaceDetailMetadata(...args: Parameters<typeof detailImpl.readWorkspaceDetailMetadata>): ReturnType<typeof detailImpl.readWorkspaceDetailMetadata> {
  return detailImpl.readWorkspaceDetailMetadata(...args);
}

export async function readWorkspaceDetailShell(...args: Parameters<typeof detailImpl.readWorkspaceDetailShell>): ReturnType<typeof detailImpl.readWorkspaceDetailShell> {
  return detailImpl.readWorkspaceDetailShell(...args);
}

export async function createWorkspaceAction(...args: Parameters<typeof lifecycleImpl.createWorkspaceAction>): ReturnType<typeof lifecycleImpl.createWorkspaceAction> {
  return lifecycleImpl.createWorkspaceAction(...args);
}

export async function updateWorkspace(...args: Parameters<typeof lifecycleImpl.updateWorkspace>): ReturnType<typeof lifecycleImpl.updateWorkspace> {
  return lifecycleImpl.updateWorkspace(...args);
}

export async function createWorkspaceCoverImageUploadUrlAction(...args: Parameters<typeof lifecycleImpl.createWorkspaceCoverImageUploadUrlAction>): ReturnType<typeof lifecycleImpl.createWorkspaceCoverImageUploadUrlAction> {
  return lifecycleImpl.createWorkspaceCoverImageUploadUrlAction(...args);
}

export async function finalizeWorkspaceCoverImageUploadAction(...args: Parameters<typeof lifecycleImpl.finalizeWorkspaceCoverImageUploadAction>): ReturnType<typeof lifecycleImpl.finalizeWorkspaceCoverImageUploadAction> {
  return lifecycleImpl.finalizeWorkspaceCoverImageUploadAction(...args);
}

export async function clearWorkspaceCoverImageAction(...args: Parameters<typeof lifecycleImpl.clearWorkspaceCoverImageAction>): ReturnType<typeof lifecycleImpl.clearWorkspaceCoverImageAction> {
  return lifecycleImpl.clearWorkspaceCoverImageAction(...args);
}

export async function updateWorkspaceExternalLinksAction(...args: Parameters<typeof lifecycleImpl.updateWorkspaceExternalLinksAction>): ReturnType<typeof lifecycleImpl.updateWorkspaceExternalLinksAction> {
  return lifecycleImpl.updateWorkspaceExternalLinksAction(...args);
}

export async function getWorkspaceAccessTransitionPreflightAction(...args: Parameters<typeof accessImpl.getWorkspaceAccessTransitionPreflightAction>): ReturnType<typeof accessImpl.getWorkspaceAccessTransitionPreflightAction> {
  return accessImpl.getWorkspaceAccessTransitionPreflightAction(...args);
}

export async function updateWorkspaceVisibilityAction(...args: Parameters<typeof accessImpl.updateWorkspaceVisibilityAction>): ReturnType<typeof accessImpl.updateWorkspaceVisibilityAction> {
  return accessImpl.updateWorkspaceVisibilityAction(...args);
}

export async function getWorkspaceAccessImpactAction(...args: Parameters<typeof accessImpl.getWorkspaceAccessImpactAction>): ReturnType<typeof accessImpl.getWorkspaceAccessImpactAction> {
  return accessImpl.getWorkspaceAccessImpactAction(...args);
}

export async function updateWorkspacePublicTabVisibilityAction(...args: Parameters<typeof accessImpl.updateWorkspacePublicTabVisibilityAction>): ReturnType<typeof accessImpl.updateWorkspacePublicTabVisibilityAction> {
  return accessImpl.updateWorkspacePublicTabVisibilityAction(...args);
}

export async function getWorkspaceCollaboratorSettingsAction(...args: Parameters<typeof settingsImpl.getWorkspaceCollaboratorSettingsAction>): ReturnType<typeof settingsImpl.getWorkspaceCollaboratorSettingsAction> {
  return settingsImpl.getWorkspaceCollaboratorSettingsAction(...args);
}

export async function getWorkspaceFileAccessSettingsAction(...args: Parameters<typeof settingsImpl.getWorkspaceFileAccessSettingsAction>): ReturnType<typeof settingsImpl.getWorkspaceFileAccessSettingsAction> {
  return settingsImpl.getWorkspaceFileAccessSettingsAction(...args);
}

export async function updateWorkspaceMemberFileUploadAction(...args: Parameters<typeof settingsImpl.updateWorkspaceMemberFileUploadAction>): ReturnType<typeof settingsImpl.updateWorkspaceMemberFileUploadAction> {
  return settingsImpl.updateWorkspaceMemberFileUploadAction(...args);
}

export async function updateWorkspaceFileUploadDefaultsAction(...args: Parameters<typeof settingsImpl.updateWorkspaceFileUploadDefaultsAction>): ReturnType<typeof settingsImpl.updateWorkspaceFileUploadDefaultsAction> {
  return settingsImpl.updateWorkspaceFileUploadDefaultsAction(...args);
}

export async function readWorkspaceNotificationSettingsAction(...args: Parameters<typeof settingsImpl.readWorkspaceNotificationSettingsAction>): ReturnType<typeof settingsImpl.readWorkspaceNotificationSettingsAction> {
  return settingsImpl.readWorkspaceNotificationSettingsAction(...args);
}

export async function updateWorkspaceNotificationSettingsAction(...args: Parameters<typeof settingsImpl.updateWorkspaceNotificationSettingsAction>): ReturnType<typeof settingsImpl.updateWorkspaceNotificationSettingsAction> {
  return settingsImpl.updateWorkspaceNotificationSettingsAction(...args);
}

export async function resetWorkspaceNotificationSettingsAction(...args: Parameters<typeof settingsImpl.resetWorkspaceNotificationSettingsAction>): ReturnType<typeof settingsImpl.resetWorkspaceNotificationSettingsAction> {
  return settingsImpl.resetWorkspaceNotificationSettingsAction(...args);
}

export async function readWorkspaceMemberNotificationSettingsAction(...args: Parameters<typeof settingsImpl.readWorkspaceMemberNotificationSettingsAction>): ReturnType<typeof settingsImpl.readWorkspaceMemberNotificationSettingsAction> {
  return settingsImpl.readWorkspaceMemberNotificationSettingsAction(...args);
}

export async function updateWorkspaceMemberNotificationSettingsAction(...args: Parameters<typeof settingsImpl.updateWorkspaceMemberNotificationSettingsAction>): ReturnType<typeof settingsImpl.updateWorkspaceMemberNotificationSettingsAction> {
  return settingsImpl.updateWorkspaceMemberNotificationSettingsAction(...args);
}

export async function resetWorkspaceMemberNotificationSettingsAction(...args: Parameters<typeof settingsImpl.resetWorkspaceMemberNotificationSettingsAction>): ReturnType<typeof settingsImpl.resetWorkspaceMemberNotificationSettingsAction> {
  return settingsImpl.resetWorkspaceMemberNotificationSettingsAction(...args);
}

export async function updateWorkspaceMemberRoleAction(...args: Parameters<typeof settingsImpl.updateWorkspaceMemberRoleAction>): ReturnType<typeof settingsImpl.updateWorkspaceMemberRoleAction> {
  return settingsImpl.updateWorkspaceMemberRoleAction(...args);
}

export async function getWorkspaceMemberRemovalPreflightAction(...args: Parameters<typeof settingsImpl.getWorkspaceMemberRemovalPreflightAction>): ReturnType<typeof settingsImpl.getWorkspaceMemberRemovalPreflightAction> {
  return settingsImpl.getWorkspaceMemberRemovalPreflightAction(...args);
}

export async function removeWorkspaceMemberAction(...args: Parameters<typeof settingsImpl.removeWorkspaceMemberAction>): ReturnType<typeof settingsImpl.removeWorkspaceMemberAction> {
  return settingsImpl.removeWorkspaceMemberAction(...args);
}

export async function getWorkspaceDangerZonePreflightAction(...args: Parameters<typeof settingsImpl.getWorkspaceDangerZonePreflightAction>): ReturnType<typeof settingsImpl.getWorkspaceDangerZonePreflightAction> {
  return settingsImpl.getWorkspaceDangerZonePreflightAction(...args);
}

export async function archiveWorkspaceAction(...args: Parameters<typeof lifecycleImpl.archiveWorkspaceAction>): ReturnType<typeof lifecycleImpl.archiveWorkspaceAction> {
  return lifecycleImpl.archiveWorkspaceAction(...args);
}

export async function deleteWorkspace(...args: Parameters<typeof lifecycleImpl.deleteWorkspace>): ReturnType<typeof lifecycleImpl.deleteWorkspace> {
  return lifecycleImpl.deleteWorkspace(...args);
}

export async function deleteWorkspaceDraftAction(...args: Parameters<typeof lifecycleImpl.deleteWorkspaceDraftAction>): ReturnType<typeof lifecycleImpl.deleteWorkspaceDraftAction> {
  return lifecycleImpl.deleteWorkspaceDraftAction(...args);
}

export async function toggleWorkspaceFollowAction(...args: Parameters<typeof lifecycleImpl.toggleWorkspaceFollowAction>): ReturnType<typeof lifecycleImpl.toggleWorkspaceFollowAction> {
  return lifecycleImpl.toggleWorkspaceFollowAction(...args);
}

export async function getWorkspaceHydrationProgressAction(...args: Parameters<typeof detailImpl.getWorkspaceHydrationProgressAction>): ReturnType<typeof detailImpl.getWorkspaceHydrationProgressAction> {
  return detailImpl.getWorkspaceHydrationProgressAction(...args);
}

export async function markTaskAsReadAction(...args: Parameters<typeof tasksImpl.markTaskAsReadAction>): ReturnType<typeof tasksImpl.markTaskAsReadAction> {
  return tasksImpl.markTaskAsReadAction(...args);
}

export async function readBoardCountsAction(...args: Parameters<typeof tasksImpl.readBoardCountsAction>): ReturnType<typeof tasksImpl.readBoardCountsAction> {
  return tasksImpl.readBoardCountsAction(...args);
}

export async function fetchWorkspaceTasksAction(...args: Parameters<typeof tasksImpl.fetchWorkspaceTasksAction>): ReturnType<typeof tasksImpl.fetchWorkspaceTasksAction> {
  return tasksImpl.fetchWorkspaceTasksAction(...args);
}

export async function fetchWorkspaceLinkPreviewsAction(...args: Parameters<typeof tasksImpl.fetchWorkspaceLinkPreviewsAction>): ReturnType<typeof tasksImpl.fetchWorkspaceLinkPreviewsAction> {
  return tasksImpl.fetchWorkspaceLinkPreviewsAction(...args);
}

export async function fetchWorkspaceTaskPreviewsAction(...args: Parameters<typeof tasksImpl.fetchWorkspaceTaskPreviewsAction>): ReturnType<typeof tasksImpl.fetchWorkspaceTaskPreviewsAction> {
  return tasksImpl.fetchWorkspaceTaskPreviewsAction(...args);
}

export async function fetchWorkspaceSprintsAction(...args: Parameters<typeof sprintsImpl.fetchWorkspaceSprintsAction>): ReturnType<typeof sprintsImpl.fetchWorkspaceSprintsAction> {
  return sprintsImpl.fetchWorkspaceSprintsAction(...args);
}

export async function fetchWorkspaceSprintDetailAction(...args: Parameters<typeof sprintsImpl.fetchWorkspaceSprintDetailAction>): ReturnType<typeof sprintsImpl.fetchWorkspaceSprintDetailAction> {
  return sprintsImpl.fetchWorkspaceSprintDetailAction(...args);
}

export async function fetchWorkspaceSprintTimelinePageAction(...args: Parameters<typeof sprintsImpl.fetchWorkspaceSprintTimelinePageAction>): ReturnType<typeof sprintsImpl.fetchWorkspaceSprintTimelinePageAction> {
  return sprintsImpl.fetchWorkspaceSprintTimelinePageAction(...args);
}

export async function readWorkspaceSprintDetail(...args: Parameters<typeof sprintsImpl.readWorkspaceSprintDetail>): ReturnType<typeof sprintsImpl.readWorkspaceSprintDetail> {
  return sprintsImpl.readWorkspaceSprintDetail(...args);
}

export async function getWorkspaceTaskDetailAction(...args: Parameters<typeof tasksImpl.getWorkspaceTaskDetailAction>): ReturnType<typeof tasksImpl.getWorkspaceTaskDetailAction> {
  return tasksImpl.getWorkspaceTaskDetailAction(...args);
}

export async function getWorkspaceMembersAction(...args: Parameters<typeof tasksImpl.getWorkspaceMembersAction>): ReturnType<typeof tasksImpl.getWorkspaceMembersAction> {
  return tasksImpl.getWorkspaceMembersAction(...args);
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

export async function countOpenSprintAssignmentsAction(...args: Parameters<typeof sprintsImpl.countOpenSprintAssignmentsAction>): ReturnType<typeof sprintsImpl.countOpenSprintAssignmentsAction> {
  return sprintsImpl.countOpenSprintAssignmentsAction(...args);
}

export async function archiveSprintAction(...args: Parameters<typeof sprintsImpl.archiveSprintAction>): ReturnType<typeof sprintsImpl.archiveSprintAction> {
  return sprintsImpl.archiveSprintAction(...args);
}

export async function cancelSprintAction(...args: Parameters<typeof sprintsImpl.cancelSprintAction>): ReturnType<typeof sprintsImpl.cancelSprintAction> {
  return sprintsImpl.cancelSprintAction(...args);
}

export async function readSprintBacklogAction(...args: Parameters<typeof sprintsImpl.readSprintBacklogAction>): ReturnType<typeof sprintsImpl.readSprintBacklogAction> {
  return sprintsImpl.readSprintBacklogAction(...args);
}
export async function planSprintSeriesAction(...args: Parameters<typeof sprintsImpl.planSprintSeriesAction>): ReturnType<typeof sprintsImpl.planSprintSeriesAction> {
  return sprintsImpl.planSprintSeriesAction(...args);
}

export async function startSprintNowAction(...args: Parameters<typeof sprintsImpl.startSprintNowAction>): ReturnType<typeof sprintsImpl.startSprintNowAction> {
  return sprintsImpl.startSprintNowAction(...args);
}

export async function addSprintMaterialAction(...args: Parameters<typeof sprintsImpl.addSprintMaterialAction>): ReturnType<typeof sprintsImpl.addSprintMaterialAction> {
  return sprintsImpl.addSprintMaterialAction(...args);
}

export async function removeSprintMaterialAction(...args: Parameters<typeof sprintsImpl.removeSprintMaterialAction>): ReturnType<typeof sprintsImpl.removeSprintMaterialAction> {
  return sprintsImpl.removeSprintMaterialAction(...args);
}

export async function searchSprintMaterialCandidatesAction(...args: Parameters<typeof sprintsImpl.searchSprintMaterialCandidatesAction>): ReturnType<typeof sprintsImpl.searchSprintMaterialCandidatesAction> {
  return sprintsImpl.searchSprintMaterialCandidatesAction(...args);
}

export async function fitSprintToParentAction(...args: Parameters<typeof sprintsImpl.fitSprintToParentAction>): ReturnType<typeof sprintsImpl.fitSprintToParentAction> {
  return sprintsImpl.fitSprintToParentAction(...args);
}

export async function planOneForEachAction(...args: Parameters<typeof sprintsImpl.planOneForEachAction>): ReturnType<typeof sprintsImpl.planOneForEachAction> {
  return sprintsImpl.planOneForEachAction(...args);
}

export async function remindSprintLeadsAction(...args: Parameters<typeof sprintsImpl.remindSprintLeadsAction>): ReturnType<typeof sprintsImpl.remindSprintLeadsAction> {
  return sprintsImpl.remindSprintLeadsAction(...args);
}

export async function deleteTaskAction(...args: Parameters<typeof tasksImpl.deleteTaskAction>): ReturnType<typeof tasksImpl.deleteTaskAction> {
  return tasksImpl.deleteTaskAction(...args);
}

export async function updateWorkspaceStageAction(...args: Parameters<typeof lifecycleImpl.updateWorkspaceStageAction>): ReturnType<typeof lifecycleImpl.updateWorkspaceStageAction> {
  return lifecycleImpl.updateWorkspaceStageAction(...args);
}

export async function updateWorkspaceLifecycleAction(...args: Parameters<typeof lifecycleImpl.updateWorkspaceLifecycleAction>): ReturnType<typeof lifecycleImpl.updateWorkspaceLifecycleAction> {
  return lifecycleImpl.updateWorkspaceLifecycleAction(...args);
}

export async function getProfileWorkspacesWithOpenRolesAction(...args: Parameters<typeof lifecycleImpl.getProfileWorkspacesWithOpenRolesAction>): ReturnType<typeof lifecycleImpl.getProfileWorkspacesWithOpenRolesAction> {
  return lifecycleImpl.getProfileWorkspacesWithOpenRolesAction(...args);
}

export async function readWorkspaceSettingsBootstrapAction(...args: Parameters<typeof settingsImpl.readWorkspaceSettingsBootstrapAction>): ReturnType<typeof settingsImpl.readWorkspaceSettingsBootstrapAction> {
  return settingsImpl.readWorkspaceSettingsBootstrapAction(...args);
}

