import { createHash } from "node:crypto";

/** The Git object id of a blob: sha1 over "blob <size>\0" + content. */
export function gitBlobSha(content: Uint8Array): string {
  return createHash("sha1").update(`blob ${content.byteLength}\0`).update(content).digest("hex");
}
