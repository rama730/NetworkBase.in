/**
 * The Content-Length a response reports, or null when it does not (COR-019). `Number(null)` is 0, so
 * reading the header directly makes a streamed response without the header look like an empty file.
 * Streamed bytes and their hash stay authoritative; a present header is only an early cross-check.
 */
export function reportedContentLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
