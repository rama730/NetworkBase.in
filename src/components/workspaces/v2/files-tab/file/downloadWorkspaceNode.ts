import { toast } from "@/lib/feedback";
import { downloadFile, saveBlob, workspaceFileUrl } from "@/lib/download";
import { useFilesStore } from "@/stores/filesStore";

/** A workspace file by id. A file with no stored bytes (linked from GitHub) is read as text and saved from memory. */
export async function downloadWorkspaceNode(projectId: string, nodeId: string, name?: string) {
  const node = useFilesStore.getState().byProjectId[projectId]?.nodesById[nodeId];
  const filename = name || node?.name || "download";
  if (node && !node.s3Key) {
    try {
      const { getWorkspaceFileContent } = await import("@/app/actions/files/content");
      saveBlob(new Blob([await getWorkspaceFileContent(projectId, nodeId)], { type: node.mimeType || "text/plain" }), filename);
      return true;
    } catch {
      toast.error("Download failed");
      return false;
    }
  }
  return downloadFile(workspaceFileUrl(projectId, nodeId), { filename });
}
