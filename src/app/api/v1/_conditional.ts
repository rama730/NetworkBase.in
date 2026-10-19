import { createHash } from "node:crypto";

import { jsonSuccess } from "@/app/api/v1/_envelope";

function matchesIfNoneMatch(header: string | null, etag: string) {
  if (!header) return false;
  if (header.trim() === "*") return true;
  const strip = (value: string) => value.trim().replace(/^W\//, "");
  return header.split(",").some((candidate) => strip(candidate) === strip(etag));
}

/**
 * A success response whose weak ETag is a hash of the exact representation (API-007): pagination,
 * filters and every returned field are covered because the validator is computed from the bytes the
 * client would receive, so a 304 can only stand for the same representation.
 */
export function jsonSuccessConditional<T>(
  request: Request,
  data: T,
  headers: Record<string, string> = { "Cache-Control": "private, no-cache" },
) {
  const etag = `W/"${createHash("sha1").update(JSON.stringify(data)).digest("base64url")}"`;
  if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
  }
  return jsonSuccess(data, undefined, { headers: { ...headers, ETag: etag } });
}
