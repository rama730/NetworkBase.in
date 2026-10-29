import { sql } from "drizzle-orm";

import { getRequestId, jsonError, logApiRoute, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { createAdminClient } from "@/lib/supabase/server";
import { SIGNED_URL_SECONDS, signedUrlSeconds } from "@/lib/messaging/attachment-ttl";
import { isUuid } from "@/lib/validations/uuid";

const BUCKET = "chat-attachments";
/**
 * Open a chat attachment: allowed for members of a channel where it is posted
 * or shown on its canvas,
 * or for the uploader before sending. Redirects to a short-lived signed URL so
 * the bytes never pass through this server.
 */
export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const startedAt = Date.now();
  const requestId = getRequestId(request);
  const { user, response: authResponse } = await requireAuthenticatedUser();
  if (!user) return authResponse ?? jsonError("Sign in to continue", 401, "UNAUTHORIZED");
  const { assetId } = await context.params;
  if (!isUuid(assetId)) return jsonError("Attachment not found", 404, "NOT_FOUND");

  const rows = await db.execute(sql`
    SELECT a.storage_key, coalesce(a.verified_mime_type, a.declared_mime_type) AS mime
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
  const row = (rows as unknown as Array<{ storage_key: string; mime: string | null }>)[0];
  const storageKey = row?.storage_key;
  if (!storageKey) return jsonError("Attachment not found", 404, "NOT_FOUND");
  const seconds = signedUrlSeconds(row.mime);

  const admin = await createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(storageKey, seconds);
  if (error || !data?.signedUrl) return jsonError("Attachment unavailable", 503, "UNAVAILABLE");
  logApiRoute(request, { requestId, action: "chat.attachments.open", userId: user.id, startedAt, success: true, status: 302 });
  return new Response(null, {
    status: 302,
    headers: { Location: data.signedUrl, "Cache-Control": `private, max-age=${SIGNED_URL_SECONDS - 60}` },
  });
}
