import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { chatChannels } from "@/lib/db/schema";

/**
 * "Also share in #general" (report §25.5): a live announcement or assignment card in the org's #general, sent
 * by the admin who posted it. Best effort: the post itself never fails because chat couldn't take the card.
 */
export async function shareToOrgGeneral(orgId: string, actorId: string, card: { kind: "announcement" | "assignment"; ref_id: string }) {
  try {
    const [general] = await db.select({ id: chatChannels.id }).from(chatChannels)
      .where(and(eq(chatChannels.projectId, orgId), eq(chatChannels.isDefault, true))).limit(1);
    if (!general) return false;
    const { sendAs } = await import("@/lib/messaging/send");
    const result = await sendAs({ id: actorId }, { channelId: general.id, body: "", clientId: `${card.kind}:${card.ref_id}` }, card);
    return result.success;
  } catch {
    return false;
  }
}
