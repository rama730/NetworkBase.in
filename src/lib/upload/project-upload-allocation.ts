import { randomUUID } from "node:crypto";
import { buildProjectFileKey, parseProjectFileKey } from "@/lib/storage/project-file-key";

export function allocateProjectObjectKey(
  projectId: string,
  requestedKey: string,
  contentType: string,
  createId: () => string = randomUUID,
): string {
  const parsed = parseProjectFileKey(requestedKey);
  if (!parsed || parsed.projectId !== projectId) {
    throw new Error("Upload request workspace does not match the allocation scope");
  }
  const requestedExtension = parsed.relativePath.split(".").pop()?.toLowerCase() || "";
  const mimeExtension = contentType.split("/")[1]?.split("+")[0]?.toLowerCase() || "";
  const extension = /^[a-z0-9]{1,16}$/.test(requestedExtension)
    ? requestedExtension
    : /^[a-z0-9]{1,16}$/.test(mimeExtension)
      ? mimeExtension
      : "";
  return buildProjectFileKey(projectId, `uploads/${createId()}${extension ? `.${extension}` : ""}`);
}
