import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { contentSettingsSchema, type ContentSettings } from "@/lib/workflows/content";

/** Report 38.8 call 6 (A2.7): channels and types are one workspace setting, workflow_settings.content (null until set up). */
export async function readContentSettings(workspaceId: string): Promise<ContentSettings | null> {
  const [row] = Array.from(await db.execute<{ content: unknown }>(sql`
    SELECT workflow_settings->'content' AS content FROM workspaces WHERE id = ${workspaceId}::uuid`));
  const parsed = contentSettingsSchema.safeParse(row?.content);
  return parsed.success ? parsed.data : null;
}

export async function writeContentSettings(workspaceId: string, settings: ContentSettings) {
  await db.execute(sql`
    UPDATE workspaces SET workflow_settings = jsonb_set(coalesce(workflow_settings, '{}'::jsonb), '{content}', ${JSON.stringify(settings)}::jsonb)
    WHERE id = ${workspaceId}::uuid`);
}
