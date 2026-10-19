/**
 * A recorded Git blob sha may be reused for a file only when the file's verified content hash equals
 * the content hash recorded with it (COR-041). Matching on node id, path or "version 1" says nothing
 * about the bytes: a replacement file at the same path would inherit another file's blob identity.
 */
export function reusableBlobSha(
  known: { localBlobSha: string | null; localHash: string | null } | null | undefined,
  currentContentHash: string | null,
): string | null {
  if (!known?.localBlobSha || !known.localHash || !currentContentHash) return null;
  return known.localHash === currentContentHash ? known.localBlobSha : null;
}
