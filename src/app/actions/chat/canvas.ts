"use server";

import { resolveAuthBaseUrl } from "@/lib/auth/redirects";
import { sql } from "drizzle-orm";

import { CANVAS_MAX_BODY, CANVAS_MAX_TITLE, canvasAssetIds } from "@/lib/messaging/canvas-store";
import { publishChannel } from "@/lib/messaging/publish";
import { chatFailure, chatRows, chatValue, invalidInput, isUuid, requireChatUser, unauthorized, uuidArray } from "@/lib/messaging/server";

export type ChannelCanvas = {
  channel_id: string;
  title: string;
  body: string;
  version: number;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string;
};

const CANVAS_COLUMNS = sql`
  c.channel_id, c.title, c.body, c.version, c.updated_by, c.updated_at,
  coalesce(p.full_name, p.username) AS updated_by_name
`;

/** Missing table or function: migration 0182 hasn't run on this database yet. */
function canvasFailure(error: unknown, action: string) {
  const code = ((error as { cause?: { code?: string } } | null)?.cause ?? (error as { code?: string } | null))?.code;
  if (code === "42P01" || code === "42883") return { success: false as const, error: "chat_canvas_not_installed" };
  return chatFailure(error, action);
}

/** The channel's canvas, or null when nobody has written one yet. */
export async function getCanvas(input: { channelId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    const [canvas] = await chatRows<ChannelCanvas>(sql`
      SELECT ${CANVAS_COLUMNS}
      FROM chat_canvases c LEFT JOIN profiles p ON p.id = c.updated_by
      WHERE c.channel_id = ${input.channelId}::uuid AND app_private.chat_is_member(c.channel_id, ${user.id}::uuid)
    `);
    return { success: true as const, canvas: canvas ?? null };
  } catch (error) {
    return canvasFailure(error, "get_canvas");
  }
}

/** Save if nobody saved since baseVersion (0 = new); otherwise chat_canvas_conflict. */
export async function saveCanvas(input: { channelId: string; title: string; body: string; baseVersion: number }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId) || typeof input.title !== "string" || typeof input.body !== "string") return invalidInput;
  if (!Number.isInteger(input.baseVersion) || input.baseVersion < 0) return invalidInput;
  if (input.title.length > CANVAS_MAX_TITLE || input.body.length > CANVAS_MAX_BODY) return invalidInput;
  try {
    const version = await chatValue<number>(sql`
      SELECT app_private.chat_save_canvas(
        ${input.channelId}::uuid, ${user.id}::uuid, ${input.title}, ${input.body},
        ${uuidArray(canvasAssetIds(input.body, resolveAuthBaseUrl({ requireConfiguredBaseInProduction: false })))}, ${input.baseVersion}::int
      ) AS value
    `);
    publishChannel(input.channelId, "canvas.changed", { channel_id: input.channelId, version, updated_by: user.id });
    return { success: true as const, version };
  } catch (error) {
    return canvasFailure(error, "save_canvas");
  }
}

export type WorkspaceCanvas = { channel_id: string; channel_name: string | null; title: string; preview: string; updated_at: string; updated_by_name: string | null };

/** Canvases in the user's other channels of a project, for "Existing canvas". */
export async function listWorkspaceCanvases(input: { projectId: string; exceptChannelId?: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.projectId)) return invalidInput;
  const except = isUuid(input.exceptChannelId) ? input.exceptChannelId : null;
  try {
    const canvases = await chatRows<WorkspaceCanvas>(sql`
      SELECT c.channel_id, ch.name AS channel_name, c.title, left(c.body, 160) AS preview, c.updated_at,
             coalesce(p.full_name, p.username) AS updated_by_name
      FROM chat_canvases c
      JOIN chat_channels ch ON ch.id = c.channel_id
      JOIN chat_channel_members m ON m.channel_id = c.channel_id AND m.user_id = ${user.id}::uuid
      LEFT JOIN profiles p ON p.id = c.updated_by
      WHERE ch.project_id = ${input.projectId}::uuid
        AND (${except}::uuid IS NULL OR c.channel_id <> ${except}::uuid)
        AND (c.title <> '' OR c.body <> '')
      ORDER BY c.updated_at DESC
      LIMIT 50
    `);
    return { success: true as const, canvases };
  } catch (error) {
    return canvasFailure(error, "list_project_canvases");
  }
}

/**
 * Remove the channel's canvas (closing its tab). An empty canvas can be removed
 * by any member; one with content only by a channel admin.
 */
export async function deleteCanvas(input: { channelId: string }) {
  const user = await requireChatUser();
  if (!user) return unauthorized;
  if (!isUuid(input?.channelId)) return invalidInput;
  try {
    const rows = await chatRows<{ channel_id: string }>(sql`
      DELETE FROM chat_canvases c
      WHERE c.channel_id = ${input.channelId}::uuid
        AND app_private.chat_is_member(c.channel_id, ${user.id}::uuid)
        AND ((c.title = '' AND c.body = '') OR app_private.chat_is_channel_admin(c.channel_id, ${user.id}::uuid))
      RETURNING c.channel_id
    `);
    if (!rows.length) {
      const [exists] = await chatRows<{ n: number }>(sql`SELECT 1 AS n FROM chat_canvases WHERE channel_id = ${input.channelId}::uuid`);
      if (exists) return { success: false as const, error: "chat_canvas_delete_forbidden" };
    }
    publishChannel(input.channelId, "canvas.changed", { channel_id: input.channelId, version: 0, updated_by: user.id, deleted: true });
    return { success: true as const };
  } catch (error) {
    return canvasFailure(error, "delete_canvas");
  }
}
