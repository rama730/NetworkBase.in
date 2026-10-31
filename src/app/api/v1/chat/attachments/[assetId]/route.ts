import { sql } from "drizzle-orm";

import { enforceDownloadLimit, enforceFileReadLimit, getRequestId, jsonError, logApiRoute, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/server";
import { SIGNED_URL_SECONDS, signedUrlSeconds } from "@/lib/messaging/attachment-ttl";
import { signedDownloadRedirect } from "@/lib/storage/download-link";
import { isUuid } from "@/lib/validations/uuid";

const BUCKET = "chat-attachments";
/**
 * Open a chat attachment: allowed for members of a channel where it is posted
 * or shown on its canvas,
 * or for the uploader before sending. Redirects to a short-lived signed URL so
 * the bytes never pass through this server. `?download=1` saves it under its real name; HEAD only answers whether
 * this person may open it.
 */
export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { user, response: authResponse } = await requireAuthenticatedUser();
  if (!user) return authResponse ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  const { assetId } = await context.params;
  if (!isUuid(assetId)) return jsonError("Attachment not found", 404, "NOT_FOUND");
  const isDownload = new URL(request.url).searchParams.get("download") === "1";
  const limited = isDownload
    ? await enforceDownloadLimit(request, user.id)
    : await enforceFileReadLimit(request, "chat:attachments", 300, 60, user.id);
  if (limited) return limited;

  const rows = await db.execute(sql`
    SELECT a.storage_key, coalesce(a.verified_mime_type, a.declared_mime_type) AS mime,
      (SELECT ca.name FROM chat_attachments ca WHERE ca.asset_id = a.id AND ca.name <> '' LIMIT 1) AS name
    FROM storage_assets a
    WHERE a.id = ${assetId}::uuid AND a.bucket = ${BUCKET} AND a.state = 'verified'
      AND (
        a.owner_user_id = ${user.id}::uuid
        OR EXISTS (
          SELECT 1 FROM chat_attachments ca
          WHERE ca.asset_id = a.id AND app_private.chat_is_member(ca.channel_id, ${user.id}::uuid)
        )
        OR EXISTS (
          SELECT 1 FROM chat_canvases cv
          WHERE cv.asset_ids @> ARRAY[a.id] AND app_private.chat_is_member(cv.channel_id, ${user.id}::uuid)
        )
      )
  `);
  const row = (rows as unknown as Array<{ storage_key: string; mime: string | null; name: string | null }>)[0];
  const storageKey = row?.storage_key;
  if (!storageKey) return jsonError("Attachment not found", 404, "NOT_FOUND");
  if (request.method === "HEAD") return new Response(null, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  const seconds = signedUrlSeconds(row.mime);

  const admin = await createAdminClient();
  if (isDownload) {
    const saved = await signedDownloadRedirect(admin, { bucket: BUCKET, storageKey, filename: row.name || `attachment${storageKey.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? ""}` });
    if (!saved) return jsonError("Attachment unavailable", 503, "UNAVAILABLE");
    logApiRoute(request, { requestId, action: "chat.attachments.download", userId: user.id, startedAt, success: true, status: 302 });
    return saved;
  }
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(storageKey, seconds);
  if (error || !data?.signedUrl) return jsonError("Attachment unavailable", 503, "UNAVAILABLE");
  logApiRoute(request, { requestId, action: "chat.attachments.open", userId: user.id, startedAt, success: true, status: 302 });
  return new Response(null, {
    status: 302,
    headers: { Location: data.signedUrl, "Cache-Control": `private, max-age=${SIGNED_URL_SECONDS - 60}` },
  });
}

export async function HEAD(request: Request, context: { params: Promise<{ assetId: string }> }) {
  return GET(request, context);
}
