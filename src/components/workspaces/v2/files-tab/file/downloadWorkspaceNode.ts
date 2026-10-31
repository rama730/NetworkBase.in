import { toast } from "@/lib/feedback";
import { downloadFile, saveBlob, workspaceFileUrl } from "@/lib/download";
import { useFilesStore } from "@/stores/filesStore";
import { fileKind } from "../../utils/fileKind";
import { isMarkdownNode } from "@/components/workspaces/v2/files-tab/file/previewPicker";

/** A workspace file by id. A text file with no stored copy (linked from GitHub) is read and saved from memory. */
export async function downloadWorkspaceNode(projectId: string, nodeId: string, name?: string) {
  const node = useFilesStore.getState().byProjectId[projectId]?.nodesById[nodeId];
  const filename = name || node?.name || "download";
  if (node && !node.s3Key) {
    // The only way to its bytes is a text read, which would silently corrupt an image or other binary file.
    if (fileKind(node) !== "text" && !isMarkdownNode(node)) {
      toast.error("This file isn’t stored here yet");
      return false;
    }
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
