import { canReadProjectTab, type ProjectAccess } from "@/lib/data/project-access";
import { canProjectMemberUploadFiles, projectMemberCan } from "@/lib/projects/settings-policies";

/**
 * Capabilities as the file actions actually enforce them (API-006): Files-tab visibility for reads,
 * and for writes the project's write access, the role capability and the member's own upload switch
 * (see assertProjectWriteAccess / assertProjectUploadAccess). A role that merely "has" a capability is
 * not enough when upload is turned off for that member.
 */
export function buildFileCapabilities(access: ProjectAccess) {
  const role = access.isOwner ? "owner" : access.isMember ? (access.memberRole || "member") : "viewer";
  const canWrite = access.canWrite;
  const can = (capability: Parameters<typeof projectMemberCan>[1]) => canWrite && projectMemberCan(role, capability);
  const canUpload = can("upload_files") && (access.isOwner || canProjectMemberUploadFiles({ role: access.memberRole, fileUploadEnabled: access.member?.fileUploadEnabled ?? null }));
  return {
    canReadFiles: canReadProjectTab(access, "files"),
    canCreateFiles: canUpload,
    canEditFiles: canUpload,
    canAcquireLock: canUpload,
    canStageToTask: can("create_tasks"),
    canMergeTask: can("merge_task"),
    canManageSettings: can("manage_settings"),
  };
}
