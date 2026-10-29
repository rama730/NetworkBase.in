import {WORKSPACE_UPLOAD_MAX_FILE_BYTES} from "@/lib/upload/security";
import { canReadWorkspaceTab, type WorkspaceAccess } from "@/lib/data/workspace-access";
import { canWorkspaceMemberUploadFiles, projectMemberCan } from "@/lib/workspaces/settings-policies";

/**
 * Capabilities as the file actions actually enforce them (API-006): Files-tab visibility for reads,
 * and for writes the project's write access, the role capability and the member's own upload switch
 * (see assertWorkspaceWriteAccess / assertWorkspaceUploadAccess). A role that merely "has" a capability is
 * not enough when upload is turned off for that member.
 */
export function buildFileCapabilities(access: WorkspaceAccess) {
  const role = access.isOwner ? "owner" : access.isMember ? (access.memberRole || "member") : "viewer";
  const canWrite = access.canWrite;
  const can = (capability: Parameters<typeof projectMemberCan>[1]) => canWrite && projectMemberCan(role, capability);
  const canUpload = can("upload_files") && (access.isOwner || canWorkspaceMemberUploadFiles({ role: access.memberRole, fileUploadEnabled: access.member?.fileUploadEnabled ?? null }));
  return {
    constraints:{maxUploadBytes:WORKSPACE_UPLOAD_MAX_FILE_BYTES,maxPathCharacters:1024,maxPathSegmentCharacters:255,inlineUploadBytes:512*1024},
    canReadFiles: canReadWorkspaceTab(access, "files"),
    canCreateFiles: canUpload,
    canEditFiles: canUpload,
    canAcquireLock: canUpload,
    canStageToTask: can("create_tasks"),
    canMergeTask: can("merge_task"),
    canManageSettings: can("manage_settings"),
  };
}
